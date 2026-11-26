import { expect, test, type Page } from "@playwright/test";
import { boot, idb, main, nav, noCrash } from "./helpers";

/** Stands in for an OpenAI-compatible server on localhost: replies with the given text as a stream, and records requests. */
async function stubModel(page: Page, reply: string) {
  const bodies: string[] = [];
  await page.route("http://localhost:1234/v1/chat/completions", async (route) => {
    bodies.push(route.request().postData() ?? "");
    const chunks = reply.match(/[\s\S]{1,40}/g)!.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`);
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "access-control-allow-origin": "*" }, body: chunks.join("") + `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 20 } })}\n\ndata: [DONE]\n\n` });
  });
  await page.evaluate(async () => {
    const { useSettings } = await import(/* @vite-ignore */ String("/src/store/settings.ts"));
    useSettings.getState().update((s: { ai: { active: string; providers: Record<string, unknown> } }) => ({ ...s, ai: { ...s.ai, active: "openaiCompatible", providers: { ...s.ai.providers, openaiCompatible: { enabled: true, model: "stub-model", baseUrl: "http://localhost:1234/v1", embedModel: "" } } } }));
  });
  return bodies;
}

test("the assistant proposes task changes; they apply only after review, and can be undone", async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    const repo = await import(/* @vite-ignore */ String("/src/data/repo.ts"));
    const { useApp } = await import(/* @vite-ignore */ String("/src/store/app.ts"));
    const ws = useApp.getState().workspaceId as string;
    await repo.createTask(ws, { title: "Renew passport", dueDate: "2026-11-20" });
    await repo.createTask(ws, { title: "Book dentist", dueDate: "2026-12-01" });
  });
  const reply = 'Here are the changes.\n```cairn-actions\n[{"op":"task","ref":"T1","status":"done"},{"op":"task","ref":"T2","due":"2026-12-05","priority":"high"},{"op":"task","ref":"T7","status":"done"}]\n```';
  const bodies = await stubModel(page, reply);

  await nav(page, "Mindstone Intelligence");
  await main(page).getByLabel("Context").selectOption("tasks");
  await main(page).getByLabel("Message").fill("Mark the passport task done and move the dentist to Dec 5, high priority.");
  await main(page).getByLabel("Message").press("Enter");

  const card = main(page).getByRole("group", { name: "Proposed changes" });
  await expect(card).toBeVisible();
  // The model saw the tasks with references and the instructions; nothing has changed yet.
  expect(bodies[0]).toContain('T1: \\"Renew passport\\"');
  expect(bodies[0]).toContain("cairn-actions");
  await expect(card.getByTestId("proposed-change")).toHaveCount(2);
  await expect(card).toContainText("1 proposal ignored");
  await expect(card).toContainText("status todo → status done");
  let tasks = await idb<{ title: string; status: string; dueDate: string; priority: string }>(page, "tasks");
  expect(tasks.find((t) => t.title === "Renew passport")?.status).toBe("todo");

  // Leave the second change out, apply the first
  await card.getByLabel(/Include: Task “Book dentist”/).uncheck();
  await card.getByRole("button", { name: "Apply 1 change" }).click();
  await expect(card).toContainText("1 change applied");
  tasks = await idb(page, "tasks");
  expect(tasks.find((t) => t.title === "Renew passport")?.status).toBe("done");
  expect(tasks.find((t) => t.title === "Book dentist")).toMatchObject({ dueDate: "2026-12-01", priority: "none" });

  // Undo, then it can be applied again (both this time)
  await card.getByRole("button", { name: "Undo" }).click();
  await expect(card).toContainText("Undone");
  tasks = await idb(page, "tasks");
  expect(tasks.find((t) => t.title === "Renew passport")?.status).toBe("todo");
  await card.getByLabel(/Include: Task “Book dentist”/).check(); // the earlier choice is kept until changed
  await card.getByRole("button", { name: "Apply 2 changes" }).click();
  await expect(card).toContainText("2 changes applied");
  tasks = await idb(page, "tasks");
  expect(tasks.find((t) => t.title === "Book dentist")).toMatchObject({ dueDate: "2026-12-05", priority: "high" });

  // The applied state survives a reload
  await page.reload();
  await nav(page, "Mindstone Intelligence");
  await main(page).getByRole("button", { name: /Mark the passport/ }).click();
  await expect(main(page).getByRole("group", { name: "Proposed changes" })).toContainText("2 changes applied");
  await noCrash(page);
});

test("the assistant can fill database fields from a database page", async ({ page }) => {
  await boot(page);
  await nav(page, "Databases");
  await main(page).getByRole("button", { name: "New database" }).click();
  await page.getByLabel("Page title").fill("Leads");
  await page.getByRole("button", { name: "New record" }).click();
  await page.getByRole("grid").getByRole("row").nth(1).getByRole("gridcell").first().click();
  await page.keyboard.type("Acme Corp");
  await page.keyboard.press("Enter");
  const bodies = await stubModel(page, 'Updating it.\n```cairn-actions\n[{"op":"field","ref":"R1","field":"Status","value":"In progress"},{"op":"field","ref":"R1","field":"Date","value":"2026-12-24"}]\n```');
  await page.keyboard.press("Control+Shift+\\");
  const panel = page.getByRole("complementary", { name: "Context panel" });
  await panel.getByRole("button", { name: "AI" }).click();
  await panel.getByLabel("Context").selectOption("page");
  await panel.getByLabel("Message").fill("Set Acme to in progress, date Dec 24");
  await panel.getByLabel("Message").press("Enter");
  const card = panel.getByRole("group", { name: "Proposed changes" });
  await expect(card.getByTestId("proposed-change")).toHaveCount(2);
  expect(bodies[0]).toContain("R1:");
  await card.getByRole("button", { name: "Apply 2 changes" }).click();
  await expect(card).toContainText("2 changes applied");
  const row = page.getByRole("grid").getByRole("row").nth(1);
  await expect(row).toContainText("In progress");
  await expect(row).toContainText(/Dec 24|2026-12-24|24/);
});
