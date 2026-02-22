# ---- build stage ----
FROM golang:1.25-alpine AS builder

WORKDIR /app

# Faster + reproducible builds
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# Build a static-ish binary (good for scratch/distroless)
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o routing-server ./...

# ---- runtime stage ----
FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /app
COPY --from=builder /app/routing-server /app/routing-server

# Router example port from spec (adjust if your server uses a different one)
EXPOSE 8080

USER nonroot:nonroot
ENTRYPOINT ["/app/routing-server"]