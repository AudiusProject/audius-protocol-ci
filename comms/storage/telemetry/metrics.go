package telemetry

import (
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo-contrib/prometheus"
)

func AddPrometheusMiddlware(server *echo.Echo) {
	p := prometheus.NewPrometheus("echo", nil)
	p.Use(server)
}