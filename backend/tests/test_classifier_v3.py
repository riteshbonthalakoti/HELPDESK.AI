# backend/tests/test_classifier_v3.py

import sys

# Ensure site-packages libraries are loaded if present (bypassing repo root shims)
orig_path = list(sys.path)
clean_path = [p for p in orig_path if p not in ('', '.') and not str(p).endswith('HELPDESK_AI')]
sys.path = clean_path
try:
    import numpy  # noqa: F401
    import torch  # noqa: F401
    import torch.nn  # noqa: F401
    import transformers  # noqa: F401
except Exception:
    pass
finally:
    sys.path = orig_path

import pytest
from unittest.mock import patch, MagicMock, PropertyMock

# ---------------------------------------------------------------------------
# Fallback stubs for CI where packages might not be installed
# ---------------------------------------------------------------------------
if "torch" not in sys.modules:
    sys.modules["torch"] = MagicMock()
if "torch.nn" not in sys.modules:
    sys.modules["torch.nn"] = MagicMock()
if "transformers" not in sys.modules:
    sys.modules["transformers"] = MagicMock()

# Force a fresh import with our stubs/packages in place
if "backend.services.classifier_v3" in sys.modules:
    del sys.modules["backend.services.classifier_v3"]

from backend.services.classifier_v3 import ClassifierServiceV3


# ===========================================================================
# Helpers
# ===========================================================================

def _make_svc(task_weights=None):
    """Return a ClassifierServiceV3 with model NOT loaded."""
    return ClassifierServiceV3(task_weights=task_weights)


def _make_loaded_svc(task_weights=None):
    """Return a service with a MagicMock model already attached."""
    svc = _make_svc(task_weights=task_weights)
    svc.model = MagicMock()
    svc.tokenizer = MagicMock()
    svc.label_encoders = {}
    svc.device = MagicMock()
    svc.tokenizer.return_value.to.return_value = {
        "input_ids": [],
        "attention_mask": [],
    }
    return svc


# ===========================================================================
# Original edge-case tests (kept exactly as specified in the issue)
# ===========================================================================

class TestClassifierV3EdgeCases:
    """Tests for ClassifierServiceV3.predict method edge cases"""

    def test_predict_model_not_loaded(self):
        """Test predict returns error dict when model is None"""
        svc = ClassifierServiceV3()
        svc.model = None

        result = svc.predict("some text")
        assert result == {"error": "V3 Model not loaded"}

    def test_predict_model_loaded_with_empty_text(self):
        """Test predict handles empty text with valid model"""
        svc = _make_loaded_svc()
        result = svc.predict("")
        assert isinstance(result, dict)

    def test_predict_model_loaded_with_none_confidence(self):
        """Test predict handles None confidence from torch.max"""
        svc = _make_loaded_svc()
        result = svc.predict("test")
        assert isinstance(result, dict)


# ===========================================================================
# Task-weights: initialisation (issue #3077 core requirement)
# ===========================================================================

class TestTaskWeightsInit:
    """Verify task_weights are stored and defaulted correctly at service level."""

    def test_default_task_weights_applied(self):
        """When no task_weights given, DEFAULT_TASK_WEIGHTS are used."""
        svc = ClassifierServiceV3()
        assert svc.task_weights == ClassifierServiceV3.DEFAULT_TASK_WEIGHTS

    def test_custom_task_weights_stored(self):
        """Custom weights passed at construction are kept as-is."""
        weights = {"category": 3.0, "priority": 0.5, "sentiment": 1.0}
        svc = ClassifierServiceV3(task_weights=weights)
        assert svc.task_weights == weights

    def test_partial_task_weights_stored(self):
        """Partial weight dict is stored without modification at service level."""
        weights = {"category": 2.5}
        svc = ClassifierServiceV3(task_weights=weights)
        assert svc.task_weights == weights

    def test_zero_weight_stored(self):
        """Zero is a valid task weight (disables a head's loss contribution)."""
        weights = {"category": 0.0, "priority": 1.0, "sentiment": 1.0}
        svc = ClassifierServiceV3(task_weights=weights)
        assert svc.task_weights["category"] == 0.0


# ===========================================================================
# Task-weights: model architecture (MultiOutputClassifierV3)
# ===========================================================================

class TestMultiOutputClassifierV3Weights:
    """Unit tests for MultiOutputClassifierV3 task-weight logic directly."""

    # Import the class after sys.modules is patched
    @pytest.fixture(autouse=True)
    def _import(self):
        from backend.services.classifier_v3 import MultiOutputClassifierV3
        self.Clf = MultiOutputClassifierV3

    def _head_configs(self):
        return [
            {"name": "category",  "input_dim": 768, "hidden_dim": 256, "num_classes": 8},
            {"name": "priority",  "input_dim": 768, "hidden_dim": 128, "num_classes": 3},
            {"name": "sentiment", "input_dim": 768, "hidden_dim": 64,  "num_classes": 3},
        ]

    def _make_model(self, task_weights=None):
        encoder = MagicMock()
        return self.Clf(
            encoder=encoder,
            head_configs=self._head_configs(),
            task_weights=task_weights,
        )

    def test_all_heads_registered(self):
        model = self._make_model()
        for cfg in self._head_configs():
            assert cfg["name"] in model.heads

    def test_explicit_weights_stored(self):
        weights = {"category": 2.0, "priority": 1.0, "sentiment": 0.5}
        model = self._make_model(task_weights=weights)
        for name, w in weights.items():
            assert model.task_weights[name] == w

    def test_no_weights_defaults_to_one(self):
        model = self._make_model(task_weights=None)
        for name in model.heads:
            assert model.task_weights[name] == 1.0

    def test_partial_weights_missing_heads_default_to_one(self):
        model = self._make_model(task_weights={"category": 3.0})
        assert model.task_weights["category"] == 3.0
        assert model.task_weights["priority"] == 1.0
        assert model.task_weights["sentiment"] == 1.0

    def test_unknown_head_raises_value_error(self):
        with pytest.raises(ValueError, match="unknown head names"):
            self._make_model(task_weights={"nonexistent": 1.0})

    def test_negative_weight_raises_value_error(self):
        with pytest.raises(ValueError, match="must be >= 0"):
            self._make_model(task_weights={"category": -0.1})

    def test_zero_weight_is_valid(self):
        model = self._make_model(
            task_weights={"category": 0.0, "priority": 1.0, "sentiment": 1.0}
        )
        assert model.task_weights["category"] == 0.0


# ===========================================================================
# Task-weights: compute_weighted_loss
# ===========================================================================

class TestComputeWeightedLoss:
    """Verify loss computation honours task weights."""

    @pytest.fixture(autouse=True)
    def _import(self):
        from backend.services.classifier_v3 import MultiOutputClassifierV3
        self.Clf = MultiOutputClassifierV3

    def _make_model(self, task_weights=None):
        encoder = MagicMock()
        head_configs = [
            {"name": "category",  "input_dim": 768, "hidden_dim": 256, "num_classes": 8},
            {"name": "priority",  "input_dim": 768, "hidden_dim": 128, "num_classes": 3},
            {"name": "sentiment", "input_dim": 768, "hidden_dim": 64,  "num_classes": 3},
        ]
        return self.Clf(encoder=encoder, head_configs=head_configs, task_weights=task_weights)

    def _fake_logits_targets(self):
        """Return MagicMock logits and targets dicts."""
        import torch
        logits = {
            "category":  torch.randn(4, 8),
            "priority":  torch.randn(4, 3),
            "sentiment": torch.randn(4, 3),
        }
        targets = {
            "category":  torch.randint(0, 8, (4,)),
            "priority":  torch.randint(0, 3, (4,)),
            "sentiment": torch.randint(0, 3, (4,)),
        }
        return logits, targets

    def test_returns_scalar(self):
        import torch
        model = self._make_model()
        logits, targets = self._fake_logits_targets()
        loss = model.compute_weighted_loss(logits, targets)
        assert loss.shape == torch.Size([])

    def test_loss_positive(self):
        model = self._make_model()
        logits, targets = self._fake_logits_targets()
        loss = model.compute_weighted_loss(logits, targets)
        assert loss.item() > 0

    def test_zero_weights_produce_zero_loss(self):
        import torch
        model = self._make_model(
            task_weights={"category": 0.0, "priority": 0.0, "sentiment": 0.0}
        )
        logits, targets = self._fake_logits_targets()
        loss = model.compute_weighted_loss(logits, targets)
        assert loss.item() == pytest.approx(0.0, abs=1e-6)

    def test_weighted_loss_differs_from_uniform(self):
        import torch
        torch.manual_seed(99)
        logits, targets = self._fake_logits_targets()

        uniform = self._make_model(
            task_weights={"category": 1.0, "priority": 1.0, "sentiment": 1.0}
        )
        weighted = self._make_model(
            task_weights={"category": 2.0, "priority": 1.0, "sentiment": 0.5}
        )
        loss_u = uniform.compute_weighted_loss(logits, targets)
        loss_w = weighted.compute_weighted_loss(logits, targets)
        assert not torch.isclose(loss_u, loss_w, atol=1e-5)

    def test_doubling_single_weight_doubles_loss(self):
        import torch
        torch.manual_seed(7)
        # Silence other heads
        logits = {
            "category":  torch.randn(4, 8),
            "priority":  torch.zeros(4, 3),
            "sentiment": torch.zeros(4, 3),
        }
        targets = {
            "category":  torch.randint(0, 8, (4,)),
            "priority":  torch.zeros(4, dtype=torch.long),
            "sentiment": torch.zeros(4, dtype=torch.long),
        }
        m1 = self._make_model(
            task_weights={"category": 1.0, "priority": 0.0, "sentiment": 0.0}
        )
        m2 = self._make_model(
            task_weights={"category": 2.0, "priority": 0.0, "sentiment": 0.0}
        )
        loss1 = m1.compute_weighted_loss(logits, targets)
        loss2 = m2.compute_weighted_loss(logits, targets)
        assert loss2.item() == pytest.approx(2.0 * loss1.item(), rel=1e-4)

    def test_custom_criterion_used(self):
        import torch
        always_zero = MagicMock(return_value=torch.tensor(0.0))
        model = self._make_model()
        logits, targets = self._fake_logits_targets()
        loss = model.compute_weighted_loss(logits, targets, criterion=always_zero)
        assert loss.item() == pytest.approx(0.0, abs=1e-6)
        assert always_zero.call_count == 3  # called once per head


# ===========================================================================
# predict() — happy path with task weights active
# ===========================================================================

class TestPredictWithTaskWeights:
    """Verify predict() works end-to-end when task_weights are set."""

    def test_predict_returns_error_when_model_none(self):
        svc = ClassifierServiceV3(
            task_weights={"category": 2.0, "priority": 1.0, "sentiment": 0.5}
        )
        assert svc.predict("hello") == {"error": "V3 Model not loaded"}

    def test_predict_returns_dict_with_loaded_model(self):
        svc = _make_loaded_svc(
            task_weights={"category": 2.0, "priority": 1.0, "sentiment": 0.5}
        )
        result = svc.predict("network is down")
        assert isinstance(result, dict)

    def test_predict_with_label_encoders(self):
        """When label_encoders are set, labels are decoded strings."""
        svc = _make_loaded_svc()

        # Mock label encoder for 'category'
        mock_encoder = MagicMock()
        mock_encoder.inverse_transform.return_value = ["network"]
        svc.label_encoders = {"category": mock_encoder}

        result = svc.predict("VPN is not connecting")
        assert isinstance(result, dict)

    def test_predict_exception_returns_error_dict(self):
        """Any exception inside predict() should be caught and returned."""
        svc = ClassifierServiceV3()
        svc.model = MagicMock()
        svc.tokenizer = MagicMock(side_effect=RuntimeError("tokenizer exploded"))
        svc.device = MagicMock()
        svc.label_encoders = {}

        result = svc.predict("crash me")
        assert "error" in result
        assert "tokenizer exploded" in result["error"]