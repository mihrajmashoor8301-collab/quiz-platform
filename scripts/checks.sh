# Build/postinstall checks (run after `npm install` in each workspace)
# 1. Install production dependencies (backend uses --omit=dev).
# 2. Run the DB schema push against the local cluster.
# 3. Lint both workspaces.
# 4. Run the test suite.
# 5. Type-check the frontend.
# Example: npx run-p install lint test typecheck

install-backend:
	npm install --omit=dev

install-frontend:
	npm install

db-push:
	npm run db-push --workspace=backend

lint:
	npm run lint --workspaces --if-present

test:
	npm run test --workspaces --if-present

typecheck:
	npm run typecheck --workspace=frontend

all:
	npm run build --if-present
	npm run test:ci --workspaces --if-present
