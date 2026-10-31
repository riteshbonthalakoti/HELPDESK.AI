import os
import torch
import torch.nn as nn
import pickle
import json
from transformers import BertTokenizerFast, BertModel

# Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_DIR = os.path.join(BASE_DIR, "models", "classifier-v3")

class MultiOutputClassifierV3(nn.Module):
    def __init__(self, num_labels_per_output: dict = None, encoder=None, head_configs=None, task_weights: dict = None):
        super().__init__()
        if encoder is not None:
            self.bert = encoder
        else:
            try:
                self.bert = BertModel.from_pretrained("bert-base-uncased")
            except Exception:
                self.bert = nn.Identity()
        
        hidden = getattr(getattr(self.bert, "config", None), "hidden_size", 768)
        self.dropout = nn.Dropout(0.3)
        self.heads = nn.ModuleDict()
        
        if head_configs is not None:
            for cfg in head_configs:
                name = cfg["name"]
                in_dim = cfg.get("input_dim", hidden)
                h_dim = cfg.get("hidden_dim", 256)
                n_classes = cfg.get("num_classes", 2)
                self.heads[name] = nn.Sequential(
                    nn.Linear(in_dim, h_dim),
                    nn.ReLU(),
                    nn.Dropout(0.1),
                    nn.Linear(h_dim, n_classes)
                )
        elif num_labels_per_output is not None:
            for name, n_labels in num_labels_per_output.items():
                self.heads[name] = nn.Sequential(
                    nn.Linear(hidden, 256),
                    nn.ReLU(),
                    nn.Dropout(0.1),
                    nn.Linear(256, n_labels)
                )

        self.task_weights = {}
        for name in self.heads:
            self.task_weights[name] = 1.0

        if task_weights is not None:
            for name, w in task_weights.items():
                if name not in self.heads:
                    raise ValueError(f"unknown head names: {name}")
                if w < 0:
                    raise ValueError("task_weights must be >= 0")
                self.task_weights[name] = float(w)

    def forward(self, input_ids, attention_mask):
        outputs = self.bert(input_ids=input_ids, attention_mask=attention_mask)
        pooled_output = getattr(outputs, "pooler_output", outputs)
        pooled_output = self.dropout(pooled_output)
        logits = {name: head(pooled_output) for name, head in self.heads.items()}
        return logits

    def compute_weighted_loss(self, logits, targets, criterion=None):
        if criterion is None:
            criterion = nn.CrossEntropyLoss()
        
        total_loss = None
        for name in self.heads:
            w = self.task_weights.get(name, 1.0)
            if name in logits and name in targets:
                loss = criterion(logits[name], targets[name])
                term = w * loss
                total_loss = term if total_loss is None else total_loss + term
                
        if total_loss is None:
            return torch.tensor(0.0)
        return total_loss

class ClassifierServiceV3:
    DEFAULT_TASK_WEIGHTS = {"category": 1.0, "subcategory": 1.0, "priority": 1.0}

    def __init__(self, task_weights: dict = None):
        self.task_weights = task_weights if task_weights is not None else self.DEFAULT_TASK_WEIGHTS.copy()
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.model = None
        self.tokenizer = None
        self.label_encoders = {}
        
        config_path = os.path.join(MODEL_DIR, "model_config.json")
        if not os.path.exists(config_path):
            return

        with open(config_path, "r") as f:
            self.num_labels = json.load(f)

        with open(os.path.join(MODEL_DIR, "label_encoders.pkl"), "rb") as f:
            self.label_encoders = pickle.load(f)

        self.model = MultiOutputClassifierV3(self.num_labels, task_weights=self.task_weights).to(self.device)
        self.model.load_state_dict(torch.load(os.path.join(MODEL_DIR, "model.pt"), map_location=self.device))
        self.model.eval()

        self.tokenizer = BertTokenizerFast.from_pretrained(MODEL_DIR)

    def predict(self, text: str):
        if self.model is None:
            return {"error": "V3 Model not loaded"}
        try:
            inputs = self.tokenizer(text, return_tensors="pt", truncation=True, padding=True, max_length=256).to(self.device)
            with torch.no_grad():
                logits = self.model(inputs["input_ids"], inputs["attention_mask"])
                
            results = {}
            for col, le in self.label_encoders.items():
                if isinstance(logits, dict) and col in logits:
                    probs = torch.softmax(logits[col], dim=1)
                    conf, pred_idx = torch.max(probs, dim=1)
                    pred_val = le.inverse_transform([pred_idx.item()])[0] if hasattr(le, "inverse_transform") else str(pred_idx.item())
                    conf_val = float(conf.item()) if conf is not None else 0.0
                    results[col] = {
                        "prediction": pred_val,
                        "confidence": conf_val
                    }
            
            if "Priority" in results:
                results["priority"] = results.pop("Priority")
            return results
        except Exception as e:
            return {"error": str(e)}

classifier_v3 = ClassifierServiceV3()
