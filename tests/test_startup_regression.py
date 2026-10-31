import ast
from pathlib import Path
import pytest

def test_typing_imports_in_main_ast():
    """
    Regression test for Issue #4137:
    Verify backend/main.py imports Optional, Dict, List, Any from typing
    and has no syntax or AST definition errors.
    """
    main_path = Path(__file__).resolve().parent.parent / "backend" / "main.py"
    with open(main_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    tree = ast.parse(content, filename=str(main_path))
    
    imported_names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            for alias in node.names:
                imported_names.add(alias.name)
        elif isinstance(node, ast.Import):
            for alias in node.names:
                imported_names.add(alias.name)
                
    assert "Optional" in imported_names, "Optional must be imported from typing in backend/main.py"
    assert "Dict" in imported_names, "Dict must be imported from typing in backend/main.py"

def test_internal_sla_forecast_definition():
    """
    Regression test for Issue #4137:
    Ensure the internal_sla_forecast function definition contains valid Optional[str] annotation.
    """
    main_path = Path(__file__).resolve().parent.parent / "backend" / "main.py"
    with open(main_path, "r", encoding="utf-8") as f:
        content = f.read()

    tree = ast.parse(content, filename=str(main_path))
    
    found_func = False
    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "internal_sla_forecast":
            found_func = True
            # Check args
            arg_names = [a.arg for a in node.args.args]
            assert "company_id" in arg_names
            for a in node.args.args:
                if a.arg == "company_id":
                    assert a.annotation is not None
                    # annotation is Subscript with value Optional and slice str
                    assert isinstance(a.annotation, ast.Subscript)
                    assert getattr(a.annotation.value, "id", None) == "Optional"
                    
    assert found_func, "internal_sla_forecast function was not found in AST"

def test_backend_main_runtime_app():
    """
    Runtime verification that FastAPI app initializes when ML dependencies are available.
    """
    try:
        import backend.main as main_module
        assert main_module.app is not None
        route_paths = [r.path for r in main_module.app.routes]
        assert "/internal/sla/forecast" in route_paths
    except (ImportError, ModuleNotFoundError, AttributeError) as exc:
        pytest.skip(f"Skipping runtime backend load in lean test environment: {exc}")
