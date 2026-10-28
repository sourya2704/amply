# One image: builds the React app, builds the Go server, and serves both on $PORT.

FROM node:22-alpine AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM golang:1.26-alpine AS api
WORKDIR /app/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -o /amply .

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
WORKDIR /app/backend
COPY --from=api /amply ./amply
COPY backend/seed ./seed
COPY --from=web /app/frontend/dist /app/frontend/dist
ENV PORT=8000
EXPOSE 8000
# -reset loads fresh demo data on every start, which is what a demo wants.
CMD ["./amply", "-reset"]
