/**
 * G3-03 — filtro por responsável no board (deep-linkável via query param).
 *
 * Verifica: os dois leads seed aparecem (um com responsável, um "Sem
 * responsável"); ao filtrar por "Sem responsável" a URL ganha ?owner=unassigned
 * e o card com dono some. Login como manager (sem MFA; vê todos os leads da org).
 *
 * Pré-requisito: seed de credenciais + seed de kanban (rodados aqui se faltarem).
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { test, expect, type Page } from "@playwright/test";

const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");

interface Creds {
  password: string;
  users: Record<string, { email: string }>;
  kanban?: { pipeline_id: string };
}

function loadCreds(): Creds {
  const needsBase = (): boolean => {
    if (!fs.existsSync(CREDS_PATH)) return true;
    const c = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
    return !c.users?.manager;
  };
  if (needsBase()) {
    execFileSync("npx", ["tsx", "scripts/seed-e2e-credentials.ts"], { stdio: "inherit" });
  }
  let c = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
  if (!c.kanban?.pipeline_id) {
    execFileSync("npx", ["tsx", "scripts/seed-e2e-kanban.ts"], { stdio: "inherit" });
    c = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
  }
  return c;
}

const creds = loadCreds();

async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(creds.password);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL(/\/app\//);
}

test("filtro por responsável reflete na URL e esconde leads com dono", async ({ page }) => {
  await login(page, creds.users.manager!.email);
  await page.goto(`/app/pipelines/${creds.kanban!.pipeline_id}`);

  const owned = page.getByRole("heading", { name: "Pedido E2E com responsavel" });
  const unowned = page.getByRole("heading", { name: "Pedido E2E sem responsavel" });
  await expect(owned).toBeVisible();
  await expect(unowned).toBeVisible();
  // A badge de ausência de dono está presente em ao menos um card.
  await expect(page.getByText("Sem responsável").first()).toBeVisible();

  // Abre o filtro de responsável e escolhe "Sem responsável".
  await page.getByRole("button", { name: /^Responsável:/ }).click();
  await page.getByRole("menuitem", { name: "Sem responsável" }).click();

  await expect(page).toHaveURL(/owner=unassigned/);
  await expect(unowned).toBeVisible();
  await expect(owned).toHaveCount(0);
});

test("manager can open the stage-aging report and adjust its threshold", async ({ page }, testInfo) => {
  await login(page, creds.users.manager!.email);
  await page.goto("/app/lead-aging?days=30");
  await expect(page.getByRole("heading", { name: /Lead aging|Envelhecimento de leads/ })).toBeVisible();
  await expect(page.getByTestId("lead-aging-summary")).toContainText("30");
  await page.getByLabel(/Days in stage|Dias na etapa/).fill("7");
  await page.getByRole("button", { name: /Show leads|Mostrar leads/ }).click();
  await expect(page).toHaveURL(/days=7/);
  await expect(page.getByTestId("lead-aging-summary")).toContainText("7");
  await page.screenshot({ path: testInfo.outputPath("lead-aging-report.png") });
});

test("anotação nova aparece no card com autor e hora, e o dossiê conserva o histórico", async ({ page, browser }, testInfo) => {
  await login(page, creds.users.manager!.email);
  await page.goto(`/app/pipelines/${creds.kanban!.pipeline_id}`);
  const title = "Pedido E2E com responsavel";
  const boardResponse = await page.request.get(`/api/v1/pipelines/${creds.kanban!.pipeline_id}/board`);
  expect(boardResponse.ok()).toBe(true);
  const board = (await boardResponse.json()).data as { leads: Array<{ id: string; title: string }> };
  const leadId = board.leads.find((lead) => lead.title === title)?.id;
  expect(leadId).toBeTruthy();
  const card = page.getByRole("group", { name: `Lead: ${title}` });
  await expect(card).toBeVisible();
  const first = `Primeira conversa ${randomUUID()}`;
  const second = `Próximo passo ${randomUUID()}`;

  await card.getByRole("button", { name: title }).click();
  const dossier = page.getByRole("dialog", { name: title });
  await dossier.getByLabel("Adicionar nota").fill(first);
  await dossier.getByRole("button", { name: "Salvar nota" }).click();
  await expect(dossier.getByText(first)).toBeVisible();
  await expect(dossier.getByLabel("Adicionar nota")).toBeEnabled();
  await dossier.getByLabel("Adicionar nota").fill(second);
  await dossier.getByRole("button", { name: "Salvar nota" }).click();
  await expect(dossier.getByText(second)).toBeVisible();
  await expect(dossier.getByText(first)).toBeVisible();
  await page.keyboard.press("Escape");

  const recent = card.getByTestId("lead-recent-note");
  await expect(recent).toContainText(second);
  await expect(recent).not.toContainText(first);
  await expect(recent).toContainText(/E2E Manager · \d/);
  await page.screenshot({ path: testInfo.outputPath("lead-recent-note.png") });

  const viewerContext = await browser.newContext();
  const viewerPage = await viewerContext.newPage();
  await login(viewerPage, creds.users.viewer!.email);
  const denied = await viewerPage.request.post(`/api/v1/leads/${leadId}/notes`, {
    data: { note: "Viewer must not add notes" },
  });
  expect(denied.status()).toBe(403);
  await viewerContext.close();
});
