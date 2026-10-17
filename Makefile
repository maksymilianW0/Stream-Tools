PROJECT_DIR := $(shell pwd)
VENV := $(PROJECT_DIR)/.venv
GLOBAL_PYTHON := python
PYTHON := $(VENV)/bin/python

SERVER_START_FILE := $(PROJECT_DIR)/src/server/main.py

.PHONY: setup

setup:
	$(GLOBAL_PYTHON) -m venv $(VENV)
	$(PYTHON) -m pip install -r $(PROJECT_DIR)/requirements.txt

dev:
	$(PYTHON) $(SERVER_START_FILE)