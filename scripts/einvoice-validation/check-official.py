#!/usr/bin/env python3
"""Run the pinned KoSIT CII XSD and SVRL rules against generated fixtures.

This intentionally uses the release artefacts directly rather than a local
copy of the validator's Java frontend.  It is a small, deterministic runner
for the CII documents produced by this repository.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


SVRL_NS = "http://purl.oclc.org/dsdl/svrl"


def fail(message: str) -> "NoReturn":
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(2)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rules", required=True, type=Path, help="extracted KoSIT configuration release")
    parser.add_argument("--manifest", required=True, type=Path, help="manifest.json created by generate-fixtures.mjs")
    parser.add_argument("--output", required=True, type=Path, help="JSON result path; never writes audit evidence")
    return parser.parse_args()


def load_dependencies():
    try:
        from lxml import etree
    except ImportError as error:
        fail(
            "lxml is missing. Use the pinned review environment, e.g. "
            "/tmp/bivaro-einvoice-review/venv/bin/python3, or install lxml in an isolated environment. "
            f"({error})"
        )
    try:
        from saxonche import PySaxonProcessor
    except ImportError as error:
        fail(
            "saxonche is missing. Use the pinned review environment, e.g. "
            "/tmp/bivaro-einvoice-review/venv/bin/python3, or install saxonche in an isolated environment. "
            f"({error})"
        )
    return etree, PySaxonProcessor


def first_existing(*paths: Path) -> Path:
    for path in paths:
        if path.is_file():
            return path
    fail("Required official rule file is missing: " + " or ".join(str(path) for path in paths))


def parse_xml(etree, path: Path):
    try:
        parser = etree.XMLParser(resolve_entities=False, no_network=True, remove_blank_text=False)
        return etree.parse(str(path), parser)
    except Exception as error:
        fail(f"Cannot parse XML fixture {path}: {error}")


def svrl_failures(etree, output: str):
    try:
        tree = etree.fromstring(output.encode("utf-8"))
    except Exception as error:
        fail(f"Official XSLT returned invalid SVRL: {error}")
    failures = []
    for assertion in tree.findall(f".//{{{SVRL_NS}}}failed-assert"):
        failures.append(
            {
                "id": assertion.get("id"),
                "flag": assertion.get("flag") or "fatal",
                "location": assertion.get("location"),
                "text": " ".join("".join(assertion.itertext()).split()),
            }
        )
    return failures


def main() -> int:
    args = parse_args()
    rules = args.rules.resolve()
    manifest_path = args.manifest.resolve()
    if not rules.is_dir():
        fail(f"Rules directory does not exist: {rules}")
    if not manifest_path.is_file():
        fail(f"Fixture manifest does not exist: {manifest_path}")

    etree, PySaxonProcessor = load_dependencies()
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception as error:
        fail(f"Cannot read fixture manifest {manifest_path}: {error}")

    xsd_path = first_existing(
        rules / "resources/cii/16b/xsd/CrossIndustryInvoice_100pD16B.xsd",
        rules / "cii/16b/xsd/CrossIndustryInvoice_100pD16B.xsd",
    )
    en_path = first_existing(
        rules / "resources/cii/16b/xsl/EN16931-CII-validation.xsl",
        rules / "EN16931-CII-validation.xsl",
    )
    xrechnung_path = first_existing(
        rules / "resources/xrechnung/3.0.2/xsl/XRechnung-CII-validation.xsl",
        rules / "xrechnung/3.0.2/xsl/XRechnung-CII-validation.xsl",
    )

    try:
        schema = etree.XMLSchema(etree.parse(str(xsd_path)))
    except Exception as error:
        fail(f"Cannot compile official CII XSD {xsd_path}: {error}")

    try:
        processor = PySaxonProcessor(license=False)
        xslt = processor.new_xslt30_processor()
        runners = {
            "EN16931": xslt.compile_stylesheet(stylesheet_file=str(en_path)),
            "XRechnung": xslt.compile_stylesheet(stylesheet_file=str(xrechnung_path)),
        }
    except Exception as error:
        fail(f"Cannot compile official CII Schematron XSLT: {error}")

    fixtures = manifest.get("fixtures")
    if not isinstance(fixtures, list) or not fixtures:
        fail("Fixture manifest has no fixtures.")

    results = []
    overall_ok = True
    for fixture in fixtures:
        name = fixture.get("name")
        filename = fixture.get("filename")
        profile = fixture.get("profile")
        if not isinstance(name, str) or not isinstance(filename, str):
            fail(f"Malformed fixture manifest entry: {fixture!r}")
        fixture_path = manifest_path.parent / filename
        if not fixture_path.is_file():
            fail(f"Fixture listed in manifest is missing: {fixture_path}")
        document = parse_xml(etree, fixture_path)
        xsd_valid = bool(schema.validate(document))
        xsd_errors = [str(error) for error in schema.error_log] if not xsd_valid else []
        validator_results = {}
        all_failures = []
        validator_names = ["EN16931"]
        if profile == "xrechnung":
            validator_names.append("XRechnung")
        for validator_name in validator_names:
            try:
                output = runners[validator_name].transform_to_string(source_file=str(fixture_path))
            except Exception as error:
                fail(f"{validator_name} XSLT failed for {name}: {error}")
            failures = svrl_failures(etree, output)
            validator_results[validator_name] = {
                "failures": failures,
                "fatalCount": sum(failure["flag"] == "fatal" for failure in failures),
                "warningCount": sum(failure["flag"] == "warning" for failure in failures),
            }
            all_failures.extend({"source": validator_name, **failure} for failure in failures)

        expected_valid = bool(fixture.get("expectedValid"))
        expected_ids = set(fixture.get("expectedFailureIds") or [])
        observed_ids = {failure["id"] for failure in all_failures}
        # Positive cases are intentionally strict: warnings are reported and
        # make the case fail. This catches arithmetic warnings such as R120.
        # KoSIT emits informational guidance for an intentionally absent
        # delivery date (BR-DE-TMP-32). It is reported below but does not make
        # an otherwise valid positive fixture fail. Fatal and warning rules do.
        observed_valid = xsd_valid and not any(failure["flag"] in {"fatal", "warning"} for failure in all_failures)
        required_ids_present = expected_ids.issubset(observed_ids)
        if expected_valid:
            case_ok = observed_valid
        else:
            case_ok = not observed_valid and required_ids_present
        if not case_ok:
            overall_ok = False
        results.append(
            {
                "name": name,
                "filename": filename,
                "profile": profile,
                "expectedValid": expected_valid,
                "observedValid": observed_valid,
                "casePassed": case_ok,
                "requiredFailureIds": sorted(expected_ids),
                "observedFailureIds": sorted(observed_ids),
                "xsd": {"path": str(xsd_path), "valid": xsd_valid, "errors": xsd_errors},
                "validators": validator_results,
                "failures": all_failures,
            }
        )

    result = {
        "harnessVersion": manifest.get("harnessVersion"),
        "rules": {
            "root": str(rules),
            "xsd": str(xsd_path),
            "en16931Cii": str(en_path),
            "xrechnungCii": str(xrechnung_path),
        },
        "calculationSource": manifest.get("calculationSource"),
        "applicationContractChecks": manifest.get("applicationContractChecks", []),
        "fixtures": results,
        "summary": {
            "fixtureCount": len(results),
            "passed": sum(case["casePassed"] for case in results),
            "failed": sum(not case["casePassed"] for case in results),
            "overallPassed": overall_ok,
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    for case in results:
        failures = ", ".join(f"{failure['source']}:{failure['id']}[{failure['flag']}]" for failure in case["failures"])
        state = "PASS" if case["casePassed"] else "FAIL"
        print(f"{state} {case['name']}: XSD={'ok' if case['xsd']['valid'] else 'FAIL'}" + (f"; {failures}" if failures else ""))
    print(f"Summary: {result['summary']['passed']}/{result['summary']['fixtureCount']} cases passed")
    return 0 if overall_ok else 1


if __name__ == "__main__":
    main()
