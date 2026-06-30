# Procura UI

Patron operativo para modulos:

1. Filtros y acciones
2. Lista o tabla principal
3. Panel de detalle opcional

Reglas:
- Una accion primaria por pantalla.
- Usar `ModuleSection` para bloques grandes.
- Usar `StatusBadge` para estados, riesgos y decisiones.
- Evitar headers duplicados: `AppShell` ya muestra el modulo activo.
- Mantener informacion densa, pero agrupada y escaneable.
