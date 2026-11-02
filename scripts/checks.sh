# Build/postinstall checks (run after `npm install` in each workspace)
# 1. Install production dependencies (backend uses --omit=dev).
# 2. Start the local PostgreSQL cluster and push the schema + seed.
# 3. Lint both workspaces.
# 4. Run the test suite.
# 5. Type-check the frontend.
# Example: npx run-p install lint test typecheck

install-backend:
	npm install --omit=dev

install-frontend:
	npm install

db-start:
	@/usr/lib/postgresql/18/bin/pg_ctl -D /home/mihraj/quiz-platform/pgdata \
		-o "-p 5432 -c listen_addresses=localhost -c unix_socket_directories=/home/mihraj/quiz-platform/sockdir" \
		-l /home/mihraj/quiz-platform/pg.log start

db-check:
	@node $(pwd)/scripts/db-ready.mjs

db-init:
	npm run db-init --workspace=backend

lint:
	npm run lint --workspaces --if-present

test:
	npm run test --workspaces --if-present

typecheck:
	npm run typecheck --workspace=frontend

all:
	npm run build --if-present
	npm run test:ci --workspaces --if-present
