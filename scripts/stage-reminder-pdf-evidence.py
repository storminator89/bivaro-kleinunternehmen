"""Fail-closed, synthetic-only reminder PDF/UI evidence for hosted acceptance.

No production files are read. All existing screenshot partitions and
their budgets are not replaced: this is a separate bounded artifact.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile

from lossless_evidence_png import recompress_png_strong

MIB = 1024 * 1024
MAX_INPUT_BYTES = 14 * MIB
MAX_OUTPUT_BYTES = 8 * MIB
MAX_PDF_BYTES = 1 * MIB
MAX_UI_BYTES = 3 * MIB
MAX_PAGES = 8
WIDTHS = (1440, 390)
EXPECTED = {"manifest.json", "reminder.pdf", "review.png", "actions.png"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def bounded_read(file, root, limit):
    require(file.resolve().is_relative_to(root), "Evidence path escapes results root")
    expected = file.lstat()
    require(stat.S_ISREG(expected.st_mode) and not file.is_symlink(), "Evidence is not a safe regular file")
    require(expected.st_nlink == 1 and 0 < expected.st_size <= limit, "Evidence file size/link bound failed")
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as handle:
        current = os.fstat(handle.fileno())
        require(stat.S_ISREG(current.st_mode) and (current.st_dev, current.st_ino, current.st_size, current.st_nlink) == (expected.st_dev, expected.st_ino, expected.st_size, 1), "Evidence changed before reading")
        data = handle.read(limit + 1)
        after = os.fstat(handle.fileno())
    require(len(data) == expected.st_size and (after.st_size, after.st_mtime_ns, after.st_ctime_ns) == (current.st_size, current.st_mtime_ns, current.st_ctime_ns), "Evidence changed while reading")
    return data


def main():
    results = Path(os.environ["BIVARO_BROWSER_RESULTS"])
    require(not results.is_symlink() and results.is_dir(), "Results root unavailable or unsafe")
    results = results.resolve()
    root = Path(os.environ["RUNNER_TEMP"])
    staging = Path(tempfile.mkdtemp(prefix="bivaro-reminder-pdf-evidence-", dir=root))
    input_bytes = 0
    output_bytes = 0
    manifest = {"version": 1, "syntheticOnly": True, "cases": []}
    try:
        for width in WIDTHS:
            matches = []
            for directory, subdirs, _ in os.walk(results, followlinks=False):
                subdirs[:] = [name for name in subdirs if not (Path(directory) / name).is_symlink()]
                if Path(directory).name == f"reminder-pdf-evidence-{width}":
                    matches.append(Path(directory))
            require(len(matches) == 1, f"Exactly one successful {width}px evidence directory required")
            source = matches[0]
            require(source.resolve().is_relative_to(results) and not source.is_symlink(), "Unsafe case directory")
            require({item.name for item in source.iterdir()} == EXPECTED, "Evidence file set is incomplete or unexpected")
            files = {}
            for name in sorted(EXPECTED):
                limit = 64 * 1024 if name.endswith(".json") else MAX_PDF_BYTES if name.endswith(".pdf") else MAX_UI_BYTES
                files[name] = bounded_read(source / name, results, limit)
                input_bytes += len(files[name])
                require(input_bytes <= MAX_INPUT_BYTES, "Aggregate evidence input exceeds 14 MiB")
            proof = json.loads(files["manifest.json"])
            require(proof.get("version") == 1 and proof.get("status") == "passed" and proof.get("width") == width, "Successful synthetic browser case required")
            require(type(proof.get("pages")) is int and 1 <= proof["pages"] <= MAX_PAGES, "PDF page count is unbounded")
            require(proof.get("balance") == {"totalCents": "12000", "paidCents": "4000", "openCents": "8000"}, "Wrong reviewed remaining balance")
            require(proof.get("downloadsChangedFinancialState") is False and proof.get("emailRequests") == [], "Unexpected financial/send effect")
            require(proof.get("originalSha256") == proof.get("originalAfterSha256"), "Original invoice bytes changed")
            require(files["reminder.pdf"].startswith(b"%PDF-") and hashlib.sha256(files["reminder.pdf"]).hexdigest() == proof.get("pdfSha256"), "Downloaded PDF hash mismatch")
            require(type(proof.get("responseBytes")) is int and 0 < proof["responseBytes"] == len(files["reminder.pdf"]) <= MAX_PDF_BYTES, "Real HTTP response byte count mismatch")
            require(proof.get("responseSha256") == proof["pdfSha256"], "Real HTTP response/download hash mismatch")
            target = staging / str(width)
            target.mkdir()
            for name in ("manifest.json", "reminder.pdf"):
                (target / name).write_bytes(files[name])
                output_bytes += len(files[name])
            for name in ("review.png", "actions.png"):
                data, pixel_proof = recompress_png_strong(files[name])
                (target / name).write_bytes(data)
                output_bytes += len(data)
                print(f"Lossless UI proof: {width}/{name} {json.dumps(pixel_proof, sort_keys=True)}")
            rendered = target / "rendered"
            rendered.mkdir()
            # Existing hosted poppler prerequisite; never execute an attachment.
            subprocess.run(["pdftoppm", "-f", "1", "-l", str(MAX_PAGES + 1), "-scale-to", "1600", "-png", str(target / "reminder.pdf"), str(rendered / "reminder")], check=True, timeout=60)
            pages = sorted(rendered.iterdir())
            require(len(pages) == proof["pages"] and all(page.name.startswith("reminder-") and page.suffix == ".png" for page in pages), "Actual rendered PDF pages do not match the complete manifest")
            page_proofs = []
            for page in pages:
                data, pixel_proof = recompress_png_strong(bounded_read(page, staging.resolve(), MAX_UI_BYTES))
                page.write_bytes(data)
                output_bytes += len(data)
                page_proofs.append({"name": page.name, "sha256": hashlib.sha256(data).hexdigest(), "pixelProof": pixel_proof})
            require(output_bytes <= MAX_OUTPUT_BYTES, "Aggregate PDF/UI artifact exceeds 8 MiB")
            manifest["cases"].append({"width": width, "pdfSha256": proof["pdfSha256"], "pages": page_proofs})
        report = json.dumps(manifest, indent=2).encode()
        require(output_bytes + len(report) <= MAX_OUTPUT_BYTES, "Final artifact exceeds 8 MiB")
        (staging / "render-manifest.json").write_bytes(report)
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
            output.write(f"directory={staging}\nready=true\n")
        print(f"Staged complete synthetic reminder PDF/UI evidence: {output_bytes + len(report)}/{MAX_OUTPUT_BYTES} bytes")
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise


if __name__ == "__main__":
    main()
