# SPDX-FileCopyrightText: 2026 PNED G.I.E.
# SPDX-License-Identifier: Apache-2.0

FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
RUN apk add --no-cache python3 py3-pip
COPY validator ./validator
RUN python3 -m venv /opt/validator && /opt/validator/bin/pip install --no-cache-dir -r validator/requirements.txt
ENV METADATA_VALIDATOR_PYTHON=/opt/validator/bin/python
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "dist/src/server.js"]
