import { describe, it, expect } from 'vitest';
import {
  interpolateBallistics,
  calculateAltitudeCorrection,
  solveMortarFireMission,
} from './ballisticsCalculator';
import {
  M252_M821_HE_CHARGE_4,
  PODNOS_O832DU_HE_CHARGE_4,
  WEAPONS,
} from '../data/ballistics';

describe('Mortar Ballistic Engine - Precision Audit & Verification', () => {
  const m252Weapon = WEAPONS.find((w) => w.id === 'm252_81mm')!;
  const podnosWeapon = WEAPONS.find((w) => w.id === '2b14_82mm')!;

  describe('1. Absolute Table Lock & Charge Integrity', () => {
    it('verifies US M252 Mortar Charge 4 (400m - 2900m) table integrity', () => {
      expect(M252_M821_HE_CHARGE_4.length).toBe(14);
      expect(M252_M821_HE_CHARGE_4[0]).toEqual({
        range: 400,
        elevation: 1415,
        tof: 34.0,
        dElevPer100m: 31.0,
        peakAlt: 1417,
        angleImpact: 85,
        dispersion: 45,
      });

      expect(M252_M821_HE_CHARGE_4[M252_M821_HE_CHARGE_4.length - 1]).toEqual({
        range: 2900,
        elevation: 750,
        tof: 22.0,
        dElevPer100m: 102.0,
        peakAlt: 593,
        angleImpact: 45,
        dispersion: 165,
      });

      // Verify intermediate milestone 1000m
      const p1000 = M252_M821_HE_CHARGE_4.find((p) => p.range === 1000)!;
      expect(p1000.elevation).toBe(1295);
      expect(p1000.tof).toBe(32.8);
      expect(p1000.dElevPer100m).toBe(34.8);
      expect(p1000.peakAlt).toBe(1319);
    });

    it('verifies Soviet 2B14 Podnos Mortar Charge 4 (400m - 2300m) table integrity', () => {
      expect(PODNOS_O832DU_HE_CHARGE_4.length).toBe(11);
      expect(PODNOS_O832DU_HE_CHARGE_4[0]).toEqual({
        range: 400,
        elevation: 1410,
        tof: 33.2,
        dElevPer100m: 30.8,
        peakAlt: 1350,
        angleImpact: 85,
        dispersion: 45,
      });

      expect(PODNOS_O832DU_HE_CHARGE_4[PODNOS_O832DU_HE_CHARGE_4.length - 1]).toEqual({
        range: 2300,
        elevation: 750,
        tof: 23.5,
        dElevPer100m: 72.0,
        peakAlt: 676,
        angleImpact: 45,
        dispersion: 118,
      });

      // Verify intermediate milestone 1400m
      const p1400 = PODNOS_O832DU_HE_CHARGE_4.find((p) => p.range === 1400)!;
      expect(p1400.elevation).toBe(1192);
      expect(p1400.tof).toBe(30.7);
      expect(p1400.dElevPer100m).toBe(38.9);
      expect(p1400.peakAlt).toBe(1155);
    });
  });

  describe('2. Advanced Linear Interpolation & Fractional Ranges', () => {
    it('calculates exact midpoint for 1450m on US M252 Ring 4', () => {
      // 1450m falls between 1400m (elev: 1202, tof: 31.5) and 1600m (elev: 1152, tof: 30.7)
      // t = (1450 - 1400) / (1600 - 1400) = 50 / 200 = 0.25
      // expected elev = 1202 + (1152 - 1202) * 0.25 = 1202 - 12.5 = 1189.5
      // expected tof = 31.5 + (30.7 - 31.5) * 0.25 = 31.5 - 0.2 = 31.3
      const interp = interpolateBallistics(M252_M821_HE_CHARGE_4, 1450);
      expect(interp).not.toBeNull();
      expect(interp!.elevation).toBeCloseTo(1189.5, 4);
      expect(interp!.timeOfFlight).toBeCloseTo(31.3, 4);
      expect(interp!.isExact).toBe(false);
    });

    it('calculates arbitrary fractional range 946m on US M252 Ring 4', () => {
      // 946m falls between 800m (elev: 1338, tof: 33.3) and 1000m (elev: 1295, tof: 32.8)
      // t = (946 - 800) / (1000 - 800) = 146 / 200 = 0.73
      // expected elev = 1338 + (1295 - 1338) * 0.73 = 1338 - 31.39 = 1306.61
      // expected tof = 33.3 + (32.8 - 33.3) * 0.73 = 33.3 - 0.365 = 32.935
      const interp = interpolateBallistics(M252_M821_HE_CHARGE_4, 946);
      expect(interp).not.toBeNull();
      expect(interp!.elevation).toBeCloseTo(1306.61, 2);
      expect(interp!.timeOfFlight).toBeCloseTo(32.935, 3);
    });

    it('interpolates Peak Altitude (Ys) and Delta Hw across segments', () => {
      // 1000m: Ys=1319, dElev=34.8; 1200m: Ys=1271, dElev=36.8
      // At 1100m (t = 0.5):
      // expected Ys = 1319 - 24 = 1295
      // expected dElev = 34.8 + 1.0 = 35.8
      const interp = interpolateBallistics(M252_M821_HE_CHARGE_4, 1100);
      expect(interp).not.toBeNull();
      expect(interp!.peakAlt).toBeCloseTo(1295, 2);
      expect(interp!.dElevPer100m).toBeCloseTo(35.8, 2);
    });
  });

  describe('3. Altitude Correction (Delta Hw) Enforcement', () => {
    it('corrects elevation when target is on a hill (Delta Alt > 0: flattens tube)', () => {
      // At 1000m, M252 base elev = 1295 mils, dElevPer100m = 34.8
      // Target is 100m above gun (Delta Alt = +100m)
      // Correction = - (100 / 100) * 34.8 = -34.8 mils
      // Corrected Elevation = 1295 - 34.8 = 1260.2 mils
      const corr = calculateAltitudeCorrection(100, 34.8);
      expect(corr).toBeCloseTo(-34.8, 4);

      const sol = solveMortarFireMission({
        weapon: m252Weapon,
        gunPos: { x: 5000, z: 5000, alt: 50 },
        targetPos: { x: 5000, z: 6000, alt: 150 }, // 1000m distance, +100m alt diff
        preferredCharge: 4,
      });

      expect(sol.horizontalDistance).toBe(1000);
      expect(sol.heightDifference).toBe(100);
      expect(sol.elevationMils).toBe(1260); // Math.round(1260.2)
      expect(sol.inRange).toBe(true);
    });

    it('corrects elevation when target is in a valley (Delta Alt < 0: raises tube)', () => {
      // At 1000m, M252 base elev = 1295 mils, dElevPer100m = 34.8
      // Target is 80m below gun (Delta Alt = -80m)
      // Correction = - (-80 / 100) * 34.8 = +27.84 mils
      // Corrected Elevation = 1295 + 27.84 = 1322.84 -> 1323 mils
      const corr = calculateAltitudeCorrection(-80, 34.8);
      expect(corr).toBeCloseTo(27.84, 4);

      const sol = solveMortarFireMission({
        weapon: m252Weapon,
        gunPos: { x: 5000, z: 5000, alt: 120 },
        targetPos: { x: 5000, z: 6000, alt: 40 }, // 1000m distance, -80m alt diff
        preferredCharge: 4,
      });

      expect(sol.heightDifference).toBe(-80);
      expect(sol.elevationMils).toBe(1323);
      expect(sol.inRange).toBe(true);
    });
  });

  describe('4. Strict Range Boundary Guards & Warning Assertions', () => {
    it('flags warning when target is below minimum range for selected charge', () => {
      const sol = solveMortarFireMission({
        weapon: m252Weapon,
        gunPos: { x: 5000, z: 5000, alt: 0 },
        targetPos: { x: 5000, z: 5300, alt: 0 }, // 300m (Charge 4 min is 400m)
        preferredCharge: 4,
      });

      expect(sol.inRange).toBe(false);
      expect(sol.warning).toContain('below minimum range (400m)');
    });

    it('flags warning when target exceeds maximum range for selected charge', () => {
      const sol = solveMortarFireMission({
        weapon: m252Weapon,
        gunPos: { x: 5000, z: 5000, alt: 0 },
        targetPos: { x: 5000, z: 8000, alt: 0 }, // 3000m (Charge 4 max is 2900m)
        preferredCharge: 4,
      });

      expect(sol.inRange).toBe(false);
      expect(sol.warning).toContain('exceeds maximum range (2900m)');
    });

    it('supports 2B14 Podnos across full 400m-2300m boundary', () => {
      const solMin = solveMortarFireMission({
        weapon: podnosWeapon,
        gunPos: { x: 5000, z: 5000, alt: 0 },
        targetPos: { x: 5000, z: 5400, alt: 0 }, // 400m
        preferredCharge: 4,
      });
      expect(solMin.inRange).toBe(true);
      expect(solMin.elevationMils).toBe(1410);

      const solMax = solveMortarFireMission({
        weapon: podnosWeapon,
        gunPos: { x: 5000, z: 5000, alt: 0 },
        targetPos: { x: 5000, z: 7300, alt: 0 }, // 2300m
        preferredCharge: 4,
      });
      expect(solMax.inRange).toBe(true);
      expect(solMax.elevationMils).toBe(750);
    });
  });
});
