FROM node:14.16 as builder
RUN apt-get install make

WORKDIR /app
COPY package*.json ./
COPY patches/* ./patches/
# Required to run package-patch: https://github.com/ds300/patch-package/issues/185
RUN npm config set unsafe-perm true
RUN --mount=type=cache,target=/root/.npm npm install --loglevel verbose

FROM node:14.16-alpine

WORKDIR /usr/src/app
COPY --from=builder /app/node_modules ./node_modules
COPY . .

RUN npm run typecheck
RUN npm run build

ARG git_sha
ENV GIT_SHA=$git_sha
