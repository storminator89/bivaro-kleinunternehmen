"""Exercise only the checker's actual AST entrypoint with a stubbed main.

The checker is never imported or run. No validator, rules, fixture generator,
application code, lxml or Saxon dependency is loaded by these cases.
"""

import ast
from pathlib import Path
import unittest


class CheckerExitTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        checker = Path(__file__).resolve().parents[1] / "einvoice-validation" / "check-official.py"
        source = ast.parse(checker.read_text(encoding="utf-8"), filename=str(checker))
        guards = [
            node
            for node in source.body
            if isinstance(node, ast.If)
            and isinstance(node.test, ast.Compare)
            and isinstance(node.test.left, ast.Name)
            and node.test.left.id == "__name__"
            and len(node.test.ops) == 1
            and isinstance(node.test.ops[0], ast.Eq)
            and len(node.test.comparators) == 1
            and isinstance(node.test.comparators[0], ast.Constant)
            and node.test.comparators[0].value == "__main__"
        ]
        if len(guards) != 1:
            raise AssertionError("Expected exactly one checker __main__ guard")
        cls.entrypoint = compile(ast.Module(body=guards, type_ignores=[]), str(checker), "exec")

    def run_entrypoint(self, result=0, error=None, name="__main__"):
        calls = []

        def main():
            calls.append("main")
            if error is not None:
                raise error
            return result

        try:
            exec(self.entrypoint, {"__name__": name, "main": main})
        except SystemExit as exit_error:
            return exit_error.code, calls
        # Normal script completion also has status 0, as before this fix.
        return 0, calls

    def test_success_exits_zero(self):
        self.assertEqual(self.run_entrypoint(result=0), (0, ["main"]))

    def test_fixture_mismatch_exits_one(self):
        self.assertEqual(self.run_entrypoint(result=1), (1, ["main"]))

    def test_existing_setup_exit_is_preserved(self):
        self.assertEqual(self.run_entrypoint(error=SystemExit(2)), (2, ["main"]))

    def test_import_does_not_invoke_main(self):
        self.assertEqual(self.run_entrypoint(name="synthetic_import"), (0, []))


if __name__ == "__main__":
    unittest.main()
