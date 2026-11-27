// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

export type ValidationFinding = {
  severity: string;
  message: string;
  focusNode: string;
  path: string;
  value: string;
  constraint: string;
};
