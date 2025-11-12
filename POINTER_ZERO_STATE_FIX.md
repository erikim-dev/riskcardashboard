# Pointer Zero-State Fix - Complete Implementation

## Problem
The gauge pointers (speed, fuel, temperature) were not staying at zero when the page loaded or when the system was powered off. Instead, they would move to data values even though the dashboard was in powered-off state.

## Root Cause
The `updateDashboard()` function was calling pointer update functions **unconditionally** on every data refresh cycle (every 5 seconds via `startDataWatcher()`), regardless of whether `engineActive` was `true` or `false`.

## Solution
Added `if (this.engineActive)` guards around all pointer update operations in the `updateDashboard()` function in `script.js`.

### Changes Made

**File:** `script.js` - `updateDashboard()` function

#### Change 1: Speed Pointer (lines ~3426-3441)
**Before:**
```javascript
try {
    // Always update the speed pointer from data...
    if (!(this._speedAnim && this._speedAnim.cancelled === false)) {
        this.updateSpeedPointer(gaugeNumeric);
    } else {
        console.debug('Skipping immediate speed pointer update during active animation');
    }
} catch (e) { /* non-fatal */ }
```

**After:**
```javascript
try {
    // Only update speed pointer when engine is active
    // When powered off, pointers remain at zero and should not move
    if (this.engineActive) {
        if (!(this._speedAnim && this._speedAnim.cancelled === false)) {
            this.updateSpeedPointer(gaugeNumeric);
        } else {
            console.debug('Skipping immediate speed pointer update during active animation');
        }
    }
} catch (e) { /* non-fatal */ }
```

#### Change 2: Fuel & Temperature Pointers (lines ~3498-3508)
**Before:**
```javascript
try {
    if (typeof this.data?.fuelValue !== 'undefined') {
        this.setFuelValue(this.data.fuelValue);
    }
    if (typeof this.data?.tempValue !== 'undefined') {
        this.setTempValue(this.data.tempValue);
    }
} catch (e) { /* non-fatal */ }
```

**After:**
```javascript
if (this.engineActive) {
    try {
        if (typeof this.data?.fuelValue !== 'undefined') {
            this.setFuelValue(this.data.fuelValue);
        }
        if (typeof this.data?.tempValue !== 'undefined') {
            this.setTempValue(this.data.tempValue);
        }
    } catch (e) { /* non-fatal */ }
}
```

## Behavior Flow

### On Page Load/Refresh
1. Body has class `powered-off` (CSS starts page dimmed)
2. `init()` is called:
   - `snapPointersToZero()` sets all pointers to 0° ✓
   - `loadRiskData()` loads data but doesn't move pointers ✓
3. `applyPowerState()` is called immediately:
   - Since `engineActive = false`, calls `snapPointersToZero()` again ✓
4. `startDataWatcher()` begins polling every 5 seconds:
   - Calls `updateDashboard()`
   - **With fix:** Pointers NOT updated because `engineActive = false` ✓

### When Engine is Started (Click Start Button)
1. `engineActive` toggles to `true`
2. `applyPowerState()` is called:
   - Removes `powered-off` class from body ✓
   - Calls `animatePointersToCurrent()` ✓
   - Pointers animate from 0 to their data values ✓
3. Future `updateDashboard()` calls:
   - **With fix:** Pointers update freely because `engineActive = true` ✓
   - Smooth animations follow data changes ✓

### When Engine is Stopped (Click Stop Button)
1. `engineActive` toggles to `false`
2. `applyPowerState()` is called:
   - Adds `powered-off` class to body ✓
   - Calls `snapPointersToZero()` ✓
   - All pointers snap to zero ✓
3. Future `updateDashboard()` calls:
   - **With fix:** Pointers NOT updated because `engineActive = false` ✓
   - Pointers remain at zero ✓

## Testing Checklist

- [ ] **Page Refresh:** All gauge pointers should be at zero position
- [ ] **Initial State:** Page should appear dimmed (powered-off CSS)
- [ ] **Click Start Button:** Pointers should animate from zero to their data values
- [ ] **Dashboard Interactive:** Can click warning lights, expand controls
- [ ] **Data Updates While Running:** Pointers follow new data values smoothly
- [ ] **Click Stop Button:** Pointers should snap immediately back to zero
- [ ] **Powered-Off State:** Dashboard dims, controls disabled, pointers frozen at zero
- [ ] **Multiple Start/Stop Cycles:** Behavior remains consistent across cycles

## Related Code

The following existing code already had proper `engineActive` checks and didn't need changes:
- `loadCarDashboardSVG()` - lines 1710-1760 ✓
- `applyPowerState()` - lines 4253-4320 ✓
- `snapPointersToZero()` - lines 4343-4368 ✓
- `animatePointersToCurrent()` - lines 4375-4395 ✓

## Technical Details

### Pointer Update Functions
- `updateSpeedPointer(value)` - Rotates speed pointer to angle for given percentage
- `setFuelValue(value)` - Updates fuel pointer from data value
- `setTempValue(value)` - Updates temperature pointer from data value

All wrapped with guard: `if (this.engineActive) { ... }`

### Data Polling
- `startDataWatcher()` - Polls every 5 seconds (5000ms)
- Fetches from `/api/data` or `./data/risk-data.json`
- Calls `updateDashboard()` when data changes
- Now respects power state with our fix

### Pointer State Management
- `snapPointersToZero()` - Sets all pointers to 0° rotation
- `animatePointersToCurrent()` - Animates pointers to current data values
- Called by `applyPowerState()` based on engine state

## Performance Impact
- Minimal: Prevents unnecessary DOM updates when powered off
- Reduces pointer animation calculations during powered-off state
- No impact when engine is running (normal behavior unchanged)
