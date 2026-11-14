.PHONY: setup dev api web test test-backend test-frontend lint fmt e2e api-types

BACKEND := uv run --directory backend
FRONTEND := pnpm -C frontend

setup:
	uv sync --directory backend
	$(FRONTEND) install
	@test -f backend/.env || cp backend/.env.example backend/.env

dev:
	@echo "API on :8000, web on :5173 (Ctrl-C stops both)"
	@trap 'kill 0' INT TERM; \
	$(BACKEND) python manage.py runserver 8000 & \
	$(FRONTEND) dev & \
	wait

api:
	$(BACKEND) python manage.py runserver 8000

web:
	$(FRONTEND) dev

test: test-backend test-frontend

test-backend:
	$(BACKEND) pytest

test-frontend:
	$(FRONTEND) test

lint:
	$(BACKEND) ruff check .
	$(BACKEND) ruff format --check .
	$(BACKEND) mypy .
	$(BACKEND) python manage.py check
	$(FRONTEND) lint
	$(FRONTEND) format:check
	$(FRONTEND) typecheck

fmt:
	$(BACKEND) ruff check --fix .
	$(BACKEND) ruff format .
	$(FRONTEND) format

e2e:
	$(FRONTEND) e2e

api-types:
	$(BACKEND) python manage.py spectacular --file openapi.yaml --validate
	$(FRONTEND) api-types
