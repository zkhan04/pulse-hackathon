FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o routing-server ./...

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=builder /app/routing-server /app/routing-server
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/app/routing-server"]