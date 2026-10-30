import pytest
import sys
import os
from unittest.mock import patch, MagicMock

sys.modules['sentence_transformers'] = MagicMock()

# Ensure we import the real service, bypassing the conftest stub
sys.path.insert(0, os.path.join(os.getcwd(), 'backend'))
from services.duplicate_service import DuplicateService



class TestDuplicateServiceAddTicket:
    """Tests for DuplicateService.add_ticket method"""

    def test_add_ticket_creates_embedding_and_persists(self):
        """Test that add_ticket stores ticket in memory and saves to disk"""
        svc = DuplicateService()
        mock_model = MagicMock()
        mock_embedding = MagicMock()
        mock_model.encode.return_value = mock_embedding
        svc.model = mock_model
        svc._loaded = True
        svc._load_failed = False

        with patch.object(svc, 'save_to_disk') as mock_save:
            svc.add_ticket("TICKET-001", "Test ticket text")

        assert len(svc._tickets) == 1
        assert svc._tickets[0][0] == "TICKET-001"
        assert svc._tickets[0][1] == mock_embedding
        assert svc._tickets[0][2] == "Test ticket text"
        mock_save.assert_called_once_with("TICKET-001", "Test ticket text")

    def test_add_ticket_degraded_mode_skips_embedding(self):
        """Test that add_ticket returns early when model is not available"""
        svc = DuplicateService()
        svc._loaded = False
        svc._load_failed = True

        with patch.object(svc, 'save_to_disk') as mock_save:
            svc.add_ticket("TICKET-002", "Another ticket")

        assert len(svc._tickets) == 0
        mock_save.assert_not_called()

    def test_add_ticket_multiple_tickets(self):
        """Test adding multiple tickets accumulates in memory"""
        svc = DuplicateService()
        mock_model = MagicMock()
        mock_model.encode.return_value = MagicMock()
        svc.model = mock_model
        svc._loaded = True

        with patch.object(svc, 'save_to_disk'):
            svc.add_ticket("TICKET-A", "First ticket")
            svc.add_ticket("TICKET-B", "Second ticket")
            svc.add_ticket("TICKET-C", "Third ticket")

        assert len(svc._tickets) == 3
        assert svc._tickets[0][0] == "TICKET-A"
        assert svc._tickets[1][0] == "TICKET-B"
        assert svc._tickets[2][0] == "TICKET-C"

    def test_add_ticket_persists_to_disk(self):
        """Test that add_ticket calls save_to_disk with correct args"""
        svc = DuplicateService()
        mock_model = MagicMock()
        mock_model.encode.return_value = MagicMock()
        svc.model = mock_model
        svc._loaded = True

        with patch.object(svc, 'save_to_disk', wraps=svc.save_to_disk) as mock_save:
            svc.add_ticket("DISK-001", "Persistent ticket")

        mock_save.assert_called_once_with("DISK-001", "Persistent ticket")

    def test_added_ticket_is_recognized_by_check_duplicate(self):
        """Verify that after add_ticket, check_duplicate successfully detects the stored ticket."""
        svc = DuplicateService()
        mock_model = MagicMock()
        mock_embedding = MagicMock()
        mock_model.encode.return_value = mock_embedding
        svc.model = mock_model
        svc._loaded = True

        with patch.object(svc, 'save_to_disk'):
            svc.add_ticket("TICKET-MATCH", "Database connection pool timeout error")

        # Mock cos_sim to return high similarity match
        mock_cos_sim = MagicMock()
        mock_cos_sim.item.return_value = 0.95
        with patch('services.duplicate_service.util.cos_sim', return_value=mock_cos_sim):
            result = svc.check_duplicate("Database connection pool timeout error")

        assert result["is_duplicate"] is True
        assert result["duplicate_ticket_id"] == "TICKET-MATCH"
        assert result["similarity"] == 0.95

    def test_add_ticket_ensures_storage_directory_creation(self, tmp_path):
        """Verify that add_ticket safely creates nested parent directory if it does not exist."""
        nested_storage = tmp_path / "custom_nested_dir" / "knowledge_base.json"
        svc = DuplicateService()
        svc.storage_file = str(nested_storage)
        mock_model = MagicMock()
        mock_model.encode.return_value = MagicMock()
        svc.model = mock_model
        svc._loaded = True

        svc.add_ticket("TICKET-DIR-01", "Verifying auto-directory creation")

        assert os.path.exists(str(nested_storage))
        with open(str(nested_storage), "r", encoding="utf-8") as f:
            data = json.load(f)
        assert data[0]["ticket_id"] == "TICKET-DIR-01"
