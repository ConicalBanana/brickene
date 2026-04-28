# Installation Guide

This guide provides detailed instructions for installing brickene in different environments.

## System Requirements

- Python 3.9 or higher
- pip or Poetry package manager

## Standard Installation

The simplest way to install brickene is using pip:

```bash
pip install brickene
```

This will install the latest stable version from PyPI.

## Installation with Poetry

If you're using Poetry for dependency management (recommended), you can add brickene to your project:

```bash
poetry add brickene
```

## Development Installation

If you want to contribute to brickene or install the latest development version, you can install directly from GitHub:

```bash
pip install git+https://github.com/ConicalBanana/brickene.git
```

Or with Poetry:

```bash
poetry add git+https://github.com/ConicalBanana/brickene.git
```

## Installing from Source

You can also install brickene from source:

```bash
git clone https://github.com/ConicalBanana/brickene.git
cd brickene
pip install .
```

Or with Poetry:

```bash
git clone https://github.com/ConicalBanana/brickene.git
cd brickene
poetry install
```

## Verifying Installation

To verify that brickene is installed correctly, you can run:

```python
import brickene
print(brickene.version)
```


Or check the CLI version:

```bash
brickene --version
```



## Troubleshooting

If you encounter any issues during installation, try the following:

1. Make sure you have the latest version of pip:

   ```bash
   pip install --upgrade pip
   ```

2. If you're behind a proxy, configure pip to use it:

   ```bash
   pip install --proxy http://user:password@proxyserver:port brickene
   ```

3. If you're having dependency conflicts, consider using a virtual environment:

   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   pip install brickene
   ```

If you still have issues, please [open an issue](<https://github.com/ConicalBanana/brickene/issues>) on our GitHub repository.
