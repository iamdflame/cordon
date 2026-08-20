# Cordon
#
#   make demo   clean checkout -> working system at localhost:5173
#   make audit  reproduce the published numbers (full corpus, ~1h ingest)

.PHONY: demo audit test clean

demo:
	docker compose up --build

audit:
	docker compose up -d hydradb
	docker compose run --rm cordon npm run build:graph
	docker compose run --rm cordon npm run audit
	docker compose run --rm cordon npm run audit:github
	docker compose run --rm cordon npm run attack

test:
	npm test

clean:
	docker compose down -v
	rm -rf .hydra-data
