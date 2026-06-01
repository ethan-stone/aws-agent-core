# ADR 0003: Backend Device Simulation for Demo Fleet State

PulseForge needs the demo fleet to feel alive end to end. Simulated devices
must affect the same backend, tool, incident, and agent paths that ordinary
devices use; a frontend-only animation would make the UI look active while
agents still reason over static product history.

Device simulation is backend-canonical. A new `apps/device-simulator` app will
own the scheduled simulation worker and manual scenario queue handler. Devices
carry their simulation source on the normal Device record, rather than living in
a separate simulated-device model. Scenario state is durable: explicit operator
or developer action queues SimulationScenario records for selected simulated
devices.

The scheduled simulation worker emits DeviceTelemetry and updates the Device
current state. In the baseline path, simulated devices draw from normal
hard-coded SimulationRanges by device type. When a queued SimulationScenario is
active, the worker draws from abnormal hard-coded ranges for the scenario type.
The first scenario vocabulary is temperature drift, connectivity loss, and
battery degradation. Scenario queue input may choose duration and the number of
consecutive affected telemetry points required before incident creation; the
default trigger threshold is immediate and duration is capped at fifteen
minutes.

The worker may create or update incidents when scenario-affected telemetry
crosses detection thresholds. It reuses an existing open incident for the same
simulated device and scenario category instead of creating duplicate incidents
on every tick.

Approved reset commands for simulated devices end every active scenario on that
device and return future telemetry toward baseline behavior. Reset does not
resolve or mitigate incidents. Incident resolution remains an explicit operator
action exposed through the incident UI and backend API.

Agents do not queue simulation scenarios. They observe the resulting device,
telemetry, and incident state through the normal tool surface.

This chooses a demo-oriented backend simulator over a UI-only mock, and chooses
a combined simulation/detection worker over a separate incident detector for
the first slice. Those boundaries can split later if PulseForge needs more
realistic alerting behavior.
