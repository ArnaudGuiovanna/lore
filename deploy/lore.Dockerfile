FROM golang:1.25 AS build
WORKDIR /src
COPY go.mod ./
COPY go.sum ./
COPY cmd ./cmd
COPY internal ./internal
COPY db ./db
RUN go build -o /out/lore ./cmd/lore

FROM gcr.io/distroless/base-debian12
COPY --from=build /out/lore /lore
COPY --from=build /src/db /db
EXPOSE 8080
ENTRYPOINT ["/lore"]
