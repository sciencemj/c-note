import { expect, test } from "bun:test";

const API_URL = "http://localhost:3001/execute";

interface ExecutionResult {
  output: string;
  error?: string;
  generatedCode?: string;
  autoFixApplied?: string[];
}

test("Executes a simple C print statement", async () => {
  const code = '#include <stdio.h>\nint main() { printf("Hello Bun+C"); return 0; }';
  
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cells: [code] })
  });
  
  const data = await response.json() as ExecutionResult;
  expect(response.ok).toBe(true);
  expect(data.output).toBe("Hello Bun+C");
});

test("Executes multiple cells and maintains state", async () => {
  const cell1 = "int global_var = 42;";
  const cell2 = '#include <stdio.h>\nint main() { printf("%d", global_var); return 0; }';
  
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cells: [cell1, cell2] })
  });
  
  const data = await response.json() as ExecutionResult;
  expect(response.ok).toBe(true);
  expect(data.output).toBe("42");
});

test("Separates output boundary correctly", async () => {
  const cell1 = '#include <stdio.h>\nint main() { printf("Cell1Output\\n"); return 0; }';
  const cell2 = 'printf("Cell2Output");';
  
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cells: [cell1, cell2] })
  });
  
  const data = await response.json() as ExecutionResult;
  expect(response.ok).toBe(true);
  // It should ONLY return output from the 2nd cell
  expect(data.output).toBe("Cell2Output");
});

test("Returns compilation errors", async () => {
  const code = "int main() { this_is_invalid_c; return 0; }";
  
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cells: [code] })
  });
  
  const data = await response.json() as ExecutionResult;
  // We still return 200 JSON but with `error` populated
  expect(data.error).toBeDefined();
  expect(data.error).toContain("error:");
});
