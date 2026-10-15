import { BallisticDataPoint, WeaponConfig, BallisticSolution } from '../types';

export interface InterpolatedBallistics {
  elevation: number;
  timeOfFlight: number;
  peakAlt: number;
  dElevPer100m: number;
  angleImpact: number;
  dispersion: number;
  isExact: boolean;
}

export interface CalculateSolutionOptions {
  weapon: WeaponConfig;
  gunPos: { x: number; z: number; alt: number };
  targetPos: { x: number; z: number; alt: number };
  preferredCharge?: number; // -1 for auto
}

/**
 * Strict linear interpolation across ballistic data points according to official in-game manual formulas:
 * Result = V1 + (V2 - V1) * ((R_target - R1) / (R2 - R1))
 */
export function interpolateBallistics(
  table: BallisticDataPoint[],
  targetDistance: number
): InterpolatedBallistics | null {
  if (!table || table.length === 0) return null;

  // Check exact match (within 0.05m tolerance)
  const exact = table.find((p) => Math.abs(p.range - targetDistance) < 0.05);
  if (exact) {
    return {
      elevation: exact.elevation,
      timeOfFlight: exact.tof,
      peakAlt: exact.peakAlt ?? (1.226 * exact.tof * exact.tof),
      dElevPer100m: exact.dElevPer100m ?? 30.0,
      angleImpact: exact.angleImpact ?? (exact.elevation * (360 / 6400)),
      dispersion: exact.dispersion ?? 40.0,
      isExact: true,
    };
  }

  const minRange = table[0].range;
  const maxRange = table[table.length - 1].range;

  // Clamping for edge evaluations or bounds
  if (targetDistance < minRange || targetDistance > maxRange) {
    return null;
  }

  // Find bounding segment
  for (let i = 0; i < table.length - 1; i++) {
    const p1 = table[i];
    const p2 = table[i + 1];

    if (targetDistance >= p1.range && targetDistance <= p2.range) {
      const rangeSpan = p2.range - p1.range;
      if (rangeSpan === 0) {
        return {
          elevation: p1.elevation,
          timeOfFlight: p1.tof,
          peakAlt: p1.peakAlt ?? 1000,
          dElevPer100m: p1.dElevPer100m ?? 30,
          angleImpact: p1.angleImpact ?? 70,
          dispersion: p1.dispersion ?? 40,
          isExact: true,
        };
      }

      const t = (targetDistance - p1.range) / rangeSpan;

      const p1Peak = p1.peakAlt ?? (1.226 * p1.tof * p1.tof);
      const p2Peak = p2.peakAlt ?? (1.226 * p2.tof * p2.tof);

      const p1dElev = p1.dElevPer100m ?? 30.0;
      const p2dElev = p2.dElevPer100m ?? 30.0;

      const p1Angle = p1.angleImpact ?? 70.0;
      const p2Angle = p2.angleImpact ?? 70.0;

      const p1Disp = p1.dispersion ?? 40.0;
      const p2Disp = p2.dispersion ?? 40.0;

      return {
        elevation: p1.elevation + (p2.elevation - p1.elevation) * t,
        timeOfFlight: p1.tof + (p2.tof - p1.tof) * t,
        peakAlt: p1Peak + (p2Peak - p1Peak) * t,
        dElevPer100m: p1dElev + (p2dElev - p1dElev) * t,
        angleImpact: p1Angle + (p2Angle - p1Angle) * t,
        dispersion: p1Disp + (p2Disp - p1Disp) * t,
        isExact: false,
      };
    }
  }

  return null;
}

/**
 * Altitude correction (Delta H_w) calculation according to manual formula:
 * Delta Alt = Target Alt - Mortar Alt
 * In mortar high-angle fire (45° to 85°), shooting to a higher altitude requires a flatter tube (lower mils),
 * while shooting into a valley requires a steeper tube (higher mils).
 * Correction = - (Delta Alt / 100) * Delta H_w
 */
export function calculateAltitudeCorrection(deltaAltMeters: number, dElevPer100m: number): number {
  return - (deltaAltMeters / 100.0) * dElevPer100m;
}

/**
 * Computes high-precision firing solution for mortar systems
 */
export function solveMortarFireMission({
  weapon,
  gunPos,
  targetPos,
  preferredCharge,
}: CalculateSolutionOptions): BallisticSolution {
  const dx = targetPos.x - gunPos.x;
  const dz = targetPos.z - gunPos.z;
  const deltaAlt = targetPos.alt - gunPos.alt;

  const horizontalDistance = Math.sqrt(dx * dx + dz * dz);
  const slantDistance = Math.sqrt(horizontalDistance * horizontalDistance + deltaAlt * deltaAlt);

  // Azimuth calculation
  let angleRad = Math.atan2(dx, dz);
  if (angleRad < 0) {
    angleRad += 2 * Math.PI;
  }
  const azimuthDeg = (angleRad * 180) / Math.PI;
  const azimuthMils = (angleRad / (2 * Math.PI)) * weapon.milsPerCircle;

  // Automatic optimal charge selection
  let recommendedCharge = 0;
  const suitableCharges = weapon.charges
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => horizontalDistance >= c.minRange && horizontalDistance <= c.maxRange);

  if (suitableCharges.length > 0) {
    // If target is within 95% of lowest charge max, pick next charge for safer angle headroom
    if (
      suitableCharges.length > 1 &&
      horizontalDistance > suitableCharges[0].c.maxRange * 0.95 &&
      horizontalDistance >= suitableCharges[1].c.minRange + 25
    ) {
      recommendedCharge = suitableCharges[1].i;
    } else {
      recommendedCharge = suitableCharges[0].i;
    }
  } else {
    // Outside all charges: choose closest boundary
    if (horizontalDistance < weapon.charges[0].minRange) {
      recommendedCharge = 0;
    } else {
      recommendedCharge = weapon.charges.length - 1;
    }
  }

  // Active charge selection: manual override vs auto
  let activeChargeIdx = recommendedCharge;
  if (preferredCharge !== undefined && preferredCharge >= 0 && weapon.charges[preferredCharge]) {
    activeChargeIdx = preferredCharge;
  }

  const selectedChargeObj = weapon.charges[activeChargeIdx] || weapon.charges[0];
  const table = selectedChargeObj.table;
  const inRange = horizontalDistance >= selectedChargeObj.minRange && horizontalDistance <= selectedChargeObj.maxRange;

  let elevationMils: number | null = null;
  let elevationDeg: number | null = null;
  let timeOfFlight: number | null = null;
  let peakAlt: number | null = null;
  let dElevPer100m: number | null = null;
  let angleImpact: number | null = null;
  let warning: string | undefined;

  // Strict boundary guard
  if (!inRange) {
    if (horizontalDistance < selectedChargeObj.minRange) {
      warning = `Target below minimum range (${Math.round(selectedChargeObj.minRange)}m) for ${selectedChargeObj.name}`;
    } else {
      warning = `Target exceeds maximum range (${Math.round(selectedChargeObj.maxRange)}m) for ${selectedChargeObj.name}`;
    }
  }

  // Linear interpolation and altitude correction
  const clampedDistance = Math.max(
    selectedChargeObj.minRange,
    Math.min(selectedChargeObj.maxRange, horizontalDistance)
  );

  const interp = interpolateBallistics(table, clampedDistance);

  if (interp) {
    dElevPer100m = Math.round(interp.dElevPer100m * 10) / 10;
    peakAlt = Math.round(interp.peakAlt);
    angleImpact = Math.round(interp.angleImpact * 10) / 10;
    timeOfFlight = Math.round(interp.timeOfFlight * 10) / 10;

    // Apply official manual formula:
    // Corrected Elevation = Interpolated Elevation + (Delta Alt / 100 * Delta H_w)
    const altitudeCorrection = calculateAltitudeCorrection(deltaAlt, interp.dElevPer100m);
    const unconstrainedElevMils = interp.elevation + altitudeCorrection;

    // Physical sight quadrant limit checks (only if within range bounds)
    if (!warning) {
      if (unconstrainedElevMils > weapon.maxElevation) {
        warning = `Corrected elevation (${Math.round(unconstrainedElevMils)} mils) exceeds maximum quadrant limit [${weapon.minElevation}–${weapon.maxElevation} mils]`;
      } else if (unconstrainedElevMils < weapon.minElevation) {
        warning = `Corrected elevation (${Math.round(unconstrainedElevMils)} mils) below minimum quadrant limit [${weapon.minElevation}–${weapon.maxElevation} mils]`;
      }
    }

    elevationMils = Math.round(unconstrainedElevMils);
    const degPerMil = 360 / weapon.milsPerCircle;
    elevationDeg = Math.round((elevationMils * degPerMil) * 10) / 10;
  }

  return {
    horizontalDistance: Math.round(horizontalDistance),
    slantDistance: Math.round(slantDistance),
    heightDifference: Math.round(deltaAlt),
    azimuthDeg: Math.round(azimuthDeg * 10) / 10,
    azimuthMils: Math.round(azimuthMils),
    charge: activeChargeIdx,
    recommendedCharge,
    elevationMils,
    elevationDeg,
    timeOfFlight,
    peakAlt,
    dElevPer100m,
    angleImpact,
    inRange,
    warning,
    ammoType: weapon.caliber,
  };
}

/**
 * Inverts elevation lookup to find the theoretical distance for a dialed elevation
 */
export function lookupRangeFromElevation(
  table: BallisticDataPoint[],
  elevationMils: number
): { range: number; tof: number; isExact: boolean } | null {
  if (!table || table.length === 0) return null;

  const exact = table.find((p) => Math.abs(p.elevation - elevationMils) < 0.2);
  if (exact) {
    return { range: exact.range, tof: exact.tof, isExact: true };
  }

  const highestElev = table[0].elevation;
  const lowestElev = table[table.length - 1].elevation;

  if (elevationMils > highestElev || elevationMils < lowestElev) {
    return null;
  }

  for (let i = 0; i < table.length - 1; i++) {
    const p1 = table[i];
    const p2 = table[i + 1];

    if (elevationMils <= p1.elevation && elevationMils >= p2.elevation) {
      const span = p2.elevation - p1.elevation;
      const t = (elevationMils - p1.elevation) / span;
      return {
        range: Math.round((p1.range + t * (p2.range - p1.range)) * 10) / 10,
        tof: Math.round((p1.tof + t * (p2.tof - p1.tof)) * 10) / 10,
        isExact: false,
      };
    }
  }

  return null;
}
