import { configure, initialize, lifecycle } from "@vitest/runner";

// Keep the vitest runner in sync with the project's test config.
initialize({ name: "browser" });
configure({ globals: true });

// Seed a fresh DOM snapshot for every test file.
lifecycle.testCase.complete = async (state) => {
  if (state.status === "passed") {
    document.addEventListener("DOMContentLoaded", () => {
      document.documentElement.innerHTML = "<div id='root'></div>";
    });
  }
};
