"""Smoke entrypoint tests: runnable with fake AlgorithmImports, no QC or orders."""
from datetime import datetime
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch
from integrations.quantconnect import lean_history_source_v1 as reader


class Frame:
    def iterrows(self):
        return iter([(("SPY", datetime(2001, 1, 3, 16)),
                      {"open": "100", "high": "102",
                       "low": "99", "close": "101", "volume": "500"})])


class Algorithm:
    is_warming_up = False

    def __init__(self):
        self.messages = []
        self.history_calls = 0
        self.fail_history = False

    def set_start_date(self, *args): pass
    def set_end_date(self, *args): pass
    def set_cash(self, *args): pass

    def add_equity(self, *args, **kwargs):
        assert kwargs["data_normalization_mode"] == "RAW"
        assert kwargs["fill_forward"] is False
        return types.SimpleNamespace(
            symbol=types.SimpleNamespace(value="SPY", id="QC-SPY"))

    def debug(self, message):
        self.messages.append(message)

    def history(self, **kwargs):
        self.history_calls += 1
        if self.fail_history:
            raise ValueError("PRIVATE_LICENSED_SOURCE_DATA")
        assert kwargs["data_normalization_mode"] == "RAW"
        assert kwargs["fill_forward"] is False
        return Frame()


class SmokeTests(unittest.TestCase):
    def setUp(self):
        imports = types.ModuleType("AlgorithmImports")
        imports.QCAlgorithm = Algorithm
        imports.Slice = type("Slice", (), {})
        imports.Resolution = types.SimpleNamespace(DAILY="DAILY")
        imports.DataNormalizationMode = types.SimpleNamespace(RAW="RAW")
        with patch.dict(sys.modules, {
            "AlgorithmImports": imports,
            "lean_history_source_v1": reader,
        }):
            spec = importlib.util.spec_from_file_location(
                "qc_raw_history_smoke",
                Path(__file__).with_name("qc_raw_history_smoke.py"))
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
        self.cls = module.SportsEdgeRawHistorySmoke
        self.imports = imports

    def test_fixed_success_no_market_values_no_orders(self):
        instance = self.cls()
        instance.initialize()
        with patch.dict(sys.modules, {"AlgorithmImports": self.imports}):
            instance.on_data(None)
            instance.on_data(None)
        self.assertEqual(instance.history_calls, 1)
        self.assertTrue(any("SMOKE_PASSED" in s for s in instance.messages))
        self.assertTrue(all("100" not in s for s in instance.messages))
        self.assertTrue(all("QC-SPY" not in s for s in instance.messages))

    def test_broker_or_data_failure_does_not_expose_exception_text(self):
        instance = self.cls()
        instance.initialize()
        instance.fail_history = True
        with patch.dict(sys.modules, {"AlgorithmImports": self.imports}):
            instance.on_data(None)
        self.assertTrue(any("SMOKE_BLOCKED" in s for s in instance.messages))
        self.assertTrue(all("PRIVATE_LICENSED_SOURCE_DATA" not in s for s in instance.messages))

    def test_no_order_or_export_endpoints(self):
        src = Path(__file__).with_name("qc_raw_history_smoke.py").read_text()
        for forbidden in ("market_order(", "set_holdings(", "liquidate(",
                          "object_store.", "download(", "requests.", "urlopen("):
            self.assertNotIn(forbidden, src)


if __name__ == "__main__":
    unittest.main()
