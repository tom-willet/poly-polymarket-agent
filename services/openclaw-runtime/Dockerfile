FROM node:20-alpine

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && corepack prepare pnpm@10.8.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY services ./services

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @poly/openclaw-runtime build

ENV NODE_ENV=production

CMD ["pnpm", "--filter", "@poly/openclaw-runtime", "exec", "node", "dist/cli.js", "socket"]
