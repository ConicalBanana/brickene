## Brickene workspace instructions

- Follow PEP 8 for all Python changes.
- Keep Python code compatible with the project's Ruff configuration in [pyproject.toml](/Users/zhichenxu/Documents/python-pkg/brickene/pyproject.toml).
- Use Google-style docstrings for Python modules, classes, and functions when docstrings are needed.
- Prefer focused, minimal edits that match the existing code style and layout of this repository.

## Python workflow

- Run Python validation inside the Anaconda environment for this project.
- Use `conda activate brick` before running Python commands, tests, or lint checks.
- For Python changes, run the narrowest relevant checks first. Prefer `pytest` for affected tests and `ruff check` for touched Python files.

## Backend and integration testing

- Treat the backend interfaces in [brickene/render_server.py](/Users/zhichenxu/Documents/python-pkg/brickene/brickene/render_server.py) and the rendering helpers in [brickene/core/rendering.py](/Users/zhichenxu/Documents/python-pkg/brickene/brickene/core/rendering.py) as the primary backend contract.
- Write or update unit tests for every backend interface you add or change.
- Keep backend interface coverage in [tests/test_backend_interfaces.py](/Users/zhichenxu/Documents/python-pkg/brickene/tests/test_backend_interfaces.py) and add focused backend tests in [tests/test_smiles_input.py](/Users/zhichenxu/Documents/python-pkg/brickene/tests/test_smiles_input.py) when graph-to-SMILES behavior changes.
- When backend HTTP behavior changes, cover request and response behavior for the relevant endpoints, including error handling.

## Frontend and full-stack validation

- If a change affects the frontend, backend, or their integration, validate the combined flow with [start.sh](/Users/zhichenxu/Documents/python-pkg/brickene/start.sh).
- Use `./start.sh` from the repository root after activating the `brick` conda environment.
- `start.sh` is the expected local smoke test for launching the Python render server and the static frontend together.

## New files

- Create new files only when they materially improve the implementation, tests, or project structure for the requested task.
- Any new Python file must follow the same PEP 8, Ruff, and Google-style docstring requirements.
