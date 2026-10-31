"""Read-only regression using an isolated temporary Hugging Face cache."""
import json
import os
from pathlib import Path
import sys
import tempfile

native = Path(__file__).resolve().parents[4] / "native"
sys.path.insert(0, str(native))
with tempfile.TemporaryDirectory(prefix="qiaomu-store-cache-audit-") as tmp:
    os.environ["HF_HOME"] = tmp
    model = Path(tmp) / "hub/models--mlx-community--whisper-large-v3-turbo"
    model.mkdir(parents=True)
    marker = model / "owned-by-another-tool.txt"
    marker.write_text("not installed by this helper")
    import uninstall
    selected = model in uninstall.engine_models()
    result = {
        "modelSelectedWithoutOwnership": selected,
        "markerStillExists": marker.exists(),
        "uninstallMutationCalled": False,
    }
    print(json.dumps(result, indent=2))
    assert not selected and marker.exists(), "Shared cache must not be included"
