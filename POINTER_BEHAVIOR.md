# Pointer Behavior Documentation

## Overview
The dashboard gauges (speed, fuel, temperature) have pointers that should respond to power state changes:
- **When powered OFF (default on refresh)**: All pointers snap to zero position
- **When powered ON**: Pointers animate to their current data values
- **When powered OFF again**: Pointers snap back to zero

## Implementation

### Pointer State Management (script.js)

The `RiskDashboard` class in `script.js` handles pointer positioning through:

1. **Initialization** (lines 268-297):
   - `snapPointersToZero()` is called during `init()`
   - Ensures pointers start at zero on page load

2. **Power State Changes** (applyPowerState() - lines 4253-4320):
   - **When turning OFF** (`!this.engineActive`):
     - Calls `snapPointersToZero()` - sets all pointers to zero rotation
     - Calls `forceRotateSpeedPointer(0)` - explicit speed pointer zeroing
     - Calls `updateFuelPointer(0)` - explicit fuel pointer zeroing
     - Calls `updateTempPointer(0)` - explicit temperature pointer zeroing
   
   - **When turning ON** (`this.engineActive`):
     - Calls `animatePointersToCurrent()` - animates pointers to current data values

### Key Functions

#### snapPointersToZero() (lines 4340-4365)
- Sets speed pointer transform to `rotate(0 cx cy)` format
- Sets fuel pointer to zero angle (`_fuelAngle0`)
- Sets temperature pointer to zero angle (`_tempAngle0`)
- Preserves any translate transforms when zeroing

#### animatePointersToCurrent() (lines 4372-4392)
- Reads current values from `this.data`:
  - Speed: uses `KRIs` or `gaugeValue`
  - Fuel: uses `fuelValue`
  - Temperature: uses `tempValue`
- Calls appropriate update functions to animate pointers to these values

### Pointer Calculation

- **Speed Pointer**: Uses `valueToAngle()` function to convert percentage (0-100) to rotation angle
- **Fuel Pointer**: Uses `_fuelAngle0` as zero reference, calculates angle based on fuel value
- **Temperature Pointer**: Uses `_tempAngle0` as zero reference, calculates angle based on temp value

All pointers rotate around their respective hub centers:
- Speed: `gaugeHubX=535.38, gaugeHubY=307.38`
- Fuel: `fuelHubX=712.68, fuelHubY=306.38`
- Temperature: `tempHubX=89.88, tempHubY=307.22`

## Testing

To verify pointer behavior:

1. **On Page Load/Refresh**:
   - Observe that all gauge pointers are at their zero positions
   - Page displays "powered-off" state visuals

2. **Click Engine Start Button**:
   - Pointers should smoothly animate to their current data values
   - Right panel and controls should become interactive
   - Dashboard should brighten

3. **Click Engine Stop Button**:
   - Pointers should immediately snap back to zero
   - Dashboard should darken/dim
   - Controls should become disabled

4. **Data Updates While Running**:
   - Pointers should animate smoothly to reflect new data values
   - No pointer movement when powered off (pointers stay at zero)

## Data Format

The dashboard expects data in `data/risk-data.json` with keys:
```json
{
  "gaugeValue": "0-100 (percentage)",
  "KRIs": "0-100 (percentage, preferred over gaugeValue)",
  "fuelValue": "0-100 (percentage)",
  "tempValue": "0-100 (percentage)",
  "SRT": "0-100 (RPM percentage)"
}
```

## Troubleshooting

**Pointers not at zero on refresh:**
- Verify `body` has class `powered-off` in CSS
- Check SVG contains elements with ids: `#speed-pointer`, `#fuel-pointer`, `#temp-pointer`
- Verify `snapPointersToZero()` is called during initialization

**Pointers don't animate when turning on:**
- Check that `data/risk-data.json` exists and loads
- Verify `this.data` contains the gauge value fields
- Check browser console for errors in `animatePointersToCurrent()`

**Pointers don't return to zero when turning off:**
- Verify `applyPowerState()` is called when engine toggle button is clicked
- Check that `this.engineActive` is toggled properly
- Ensure `snapPointersToZero()` function is working (check transform attributes in browser dev tools)
