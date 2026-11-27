// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const asset = (name: string) =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");

export const dashboardHtml = asset("./dashboard.html");
export const dashboardCss = asset("./dashboard.css");
export const dashboardJs = asset("./dashboard.js");
