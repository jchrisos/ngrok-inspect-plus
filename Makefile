# ngrok-inspect-plus — developer tasks.
#
# There is NO build step: this is a plain unpacked Manifest V3 extension loaded
# straight from the repo root. These targets only run tests, validate syntax, and
# help bring up the local ngrok dashboard for manual testing.
#
#   make            # help
#   make test       # unit tests (no browser)
#   make e2e        # end-to-end smoke test in a real Chrome (no npm deps)
#   make fixtures   # controlled response bodies on :8080 (terminal A)
#   make tunnel     # ngrok tunnel            (terminal B)
#   make traffic    # send every branch through the tunnel (terminal C)
#   make stop       # kill the tunnel + servers

SHELL := /bin/bash
.DEFAULT_GOAL := help

PORT      ?= 8080
SUBDOMAIN ?= test-extension
TUNNEL_URL ?= https://$(SUBDOMAIN).sa.ngrok.io

.PHONY: help test check load serve tunnel traffic fixtures stop e2e

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-9s\033[0m %s\n", $$1, $$2}'

test: ## Run the pure-logic unit tests (node --test)
	node --test 'tests/*.test.js' 'tests/*.test.mjs'

e2e: ## End-to-end smoke test in a real Chrome (no npm deps; see tests/e2e/run.mjs)
	node tests/e2e/run.mjs

check: ## Syntax-check all JS and validate the JSON manifests
	@for f in content/*.js content/features/*.js background/*.js theme/apply-dark.js theme/apply-dark-auto.js popup/popup.js tests/*.js tests/*.mjs tests/e2e/*.mjs; do \
		node --check "$$f" || exit 1; \
	done
	@python3 -m json.tool manifest.json >/dev/null && echo "manifest.json OK"
	@python3 -m json.tool package.json >/dev/null && echo "package.json OK"

load: ## Print the load-unpacked / reload steps
	@echo "1. chrome://extensions -> enable Developer mode -> Load unpacked -> select this repo root"
	@echo "2. After editing content scripts or CSS: reload the dashboard tab (Cmd+R)"
	@echo "3. After editing background/service-worker.js: click the extension's reload icon, then reload the tab"
	@echo "4. After editing manifest.json: reload the extension, then the tab"

serve: ## Serve the current directory on :8080 (simple, no edge cases)
	python3 -m http.server $(PORT)

fixtures: ## Serve controlled response bodies on :8080 (for edge-case testing)
	python3 tools/fixture-server.py --port $(PORT)

tunnel: ## Open the ngrok tunnel (dashboard at http://localhost:4040)
	ngrok http $(PORT) --subdomain $(SUBDOMAIN)

traffic: ## Send every fixture through the tunnel to populate the dashboard
	@echo "sending fixtures to $(TUNNEL_URL) ..."
	@curl -s -o /dev/null "$(TUNNEL_URL)/" || true
	@curl -s -o /dev/null -X POST "$(TUNNEL_URL)/hello?x=1" \
		-H 'X-Custom-Header: abc123' -H 'Content-Type: application/json' \
		--data-raw '{"name":"julio","n":2}' || true
	@curl -s -o /dev/null "$(TUNNEL_URL)/data.json" || true
	@curl -s -o /dev/null "$(TUNNEL_URL)/page.html" || true
	@curl -s -o /dev/null "$(TUNNEL_URL)/latin1" || true
	@curl -s -o /dev/null "$(TUNNEL_URL)/empty" || true
	@curl -s -o /dev/null "$(TUNNEL_URL)/truncated" || true
	@curl -s -o /dev/null "$(TUNNEL_URL)/blob.bin" || true
	@curl -s -o /dev/null "$(TUNNEL_URL)/large.txt" || true
	@curl -s -o /dev/null "$(TUNNEL_URL)/huge.txt" || true
	@echo "done -> open http://localhost:4040/inspect/http and select a request"

stop: ## Kill the ngrok tunnel and any fixture/serve process
	-@pkill -f "ngrok http $(PORT)" 2>/dev/null || true
	-@pkill -f "http.server $(PORT)" 2>/dev/null || true
	-@pkill -f "tools/fixture-server.py" 2>/dev/null || true
	@echo "stopped (verify with: lsof -nP -iTCP:$(PORT) -iTCP:4040 -sTCP:LISTEN)"
