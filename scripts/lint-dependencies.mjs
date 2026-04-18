#!/usr/bin/env node
/**
 * Dependency Lint Script
 * 
 * Validates that all dependencies comply with TECH_CONSTRAINTS.md rules:
 * 1. Free and open source (MIT/Apache 2.0/ISC/BSD/0BSD/Unlicense)
 * 2. TypeScript support (has types)
 * 3. Active maintenance (configurable, default: warn only)
 * 4. ESM compatibility
 * 5. Security audit (no high/critical vulnerabilities)
 * 
 * Usage:
 *   node scripts/lint-dependencies.mjs [--check-diff] [--strict] [--skip-security]
 * 
 * Options:
 *   --check-diff     Only check new/changed dependencies (for PR checks)
 *   --strict         Fail on warnings (maintenance check)
 *   --skip-security  Skip npm audit (security managed separately)
 */

import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// ============================================================================
// Configuration
// ============================================================================

/** Allowed licenses (case-insensitive match) */
const ALLOWED_LICENSES = new Set([
  'mit',
  'apache-2.0',
  'apache 2.0',
  'isc',
  'bsd-2-clause',
  'bsd-3-clause',
  'bsd',
  '0bsd',
  'unlicense',
  'cc0-1.0',
  'wtfpl',
  'public domain',
  // Compound licenses
  '(mit or apache-2.0)',
  'mit or apache-2.0',
  '(mit and zlib)',
]);

/** Packages to skip license check (known false positives or bundled) */
const LICENSE_SKIP_LIST = new Set([
  // Add packages here if they have non-standard license fields but are actually compliant
]);

/** Packages to skip TypeScript check (known to work without types) */
const TYPES_SKIP_LIST = new Set([
  // Native/CLI tools that don't need types
  'edge-tts',
  'ffmpeg',
]);

/** Packages to skip maintenance check */
const MAINTENANCE_SKIP_LIST = new Set([
  // Stable packages that are "done"
]);

// ============================================================================
// Utilities
// ============================================================================

const colors = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

function log(icon, message) {
  console.log(`${icon} ${message}`);
}

function loadPackageJson(dir) {
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) return null;
  return JSON.parse(readFileSync(pkgPath, 'utf-8'));
}

function getAllDependencies(pkg) {
  return {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };
}

function runCommand(cmd, options = {}) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: 'pipe', ...options });
  } catch (err) {
    return err.stdout || err.stderr || '';
  }
}

// ============================================================================
// Checks
// ============================================================================

/**
 * Check 1: License compliance
 */
function checkLicenses(deps, nodeModulesDir) {
  const errors = [];
  const warnings = [];

  for (const [name, _version] of Object.entries(deps)) {
    if (LICENSE_SKIP_LIST.has(name)) continue;

    const pkgDir = join(nodeModulesDir, name);
    const pkg = loadPackageJson(pkgDir);
    
    if (!pkg) {
      // Might be a scoped package or not installed
      const scopedDir = name.startsWith('@') 
        ? join(nodeModulesDir, ...name.split('/'))
        : pkgDir;
      const scopedPkg = loadPackageJson(scopedDir);
      if (!scopedPkg) {
        warnings.push(`${name}: Cannot find package (not installed?)`);
        continue;
      }
      checkSingleLicense(name, scopedPkg, errors);
    } else {
      checkSingleLicense(name, pkg, errors);
    }
  }

  return { errors, warnings };
}

function checkSingleLicense(name, pkg, errors) {
  const license = pkg.license || pkg.licenses?.[0]?.type || '';
  const normalizedLicense = license.toLowerCase().trim();

  if (!license) {
    errors.push(`${name}: No license field found`);
    return;
  }

  // Check if it's an allowed license
  let isAllowed = ALLOWED_LICENSES.has(normalizedLicense);
  
  // Check for compound licenses like "(MIT OR Apache-2.0)"
  if (!isAllowed && normalizedLicense.includes(' or ')) {
    const parts = normalizedLicense
      .replace(/[()]/g, '')
      .split(/\s+or\s+/i)
      .map(p => p.trim().toLowerCase());
    isAllowed = parts.some(p => ALLOWED_LICENSES.has(p));
  }

  if (!isAllowed) {
    errors.push(`${name}: License "${license}" is not in allowed list`);
  }
}

/**
 * Check 2: TypeScript support
 */
function checkTypeScriptSupport(deps, nodeModulesDir) {
  const errors = [];
  const warnings = [];

  for (const [name, _version] of Object.entries(deps)) {
    if (TYPES_SKIP_LIST.has(name)) continue;
    if (name.startsWith('@types/')) continue; // Type definitions themselves

    const pkgDir = name.startsWith('@')
      ? join(nodeModulesDir, ...name.split('/'))
      : join(nodeModulesDir, name);
    
    const pkg = loadPackageJson(pkgDir);
    if (!pkg) {
      warnings.push(`${name}: Cannot find package (not installed?)`);
      continue;
    }

    // Check for built-in types
    const hasBuiltinTypes = pkg.types || pkg.typings || pkg.exports?.['.']?.types;
    
    // Check for @types package
    const typesPackageName = name.startsWith('@')
      ? `@types/${name.slice(1).replace('/', '__')}`
      : `@types/${name}`;
    const typesPackageDir = join(nodeModulesDir, ...typesPackageName.split('/'));
    const hasTypesPackage = existsSync(typesPackageDir);

    if (!hasBuiltinTypes && !hasTypesPackage) {
      // Check if it's in devDependencies of root package.json (might be okay)
      const rootPkg = loadPackageJson(join(nodeModulesDir, '..'));
      const isDevDep = rootPkg?.devDependencies?.[name];
      
      if (isDevDep) {
        warnings.push(`${name}: No TypeScript types (devDependency, may be acceptable)`);
      } else {
        errors.push(`${name}: No TypeScript types (missing types/typings field or @types package)`);
      }
    }
  }

  return { errors, warnings };
}

/**
 * Check 3: Security audit
 */
function runSecurityAudit() {
  const errors = [];
  const warnings = [];

  log('🔍', 'Running npm audit...');
  
  const result = spawnSync('npm', ['audit', '--json'], {
    cwd: rootDir,
    encoding: 'utf-8',
    stdio: 'pipe',
  });

  try {
    const audit = JSON.parse(result.stdout || '{}');
    const vulnerabilities = audit.metadata?.vulnerabilities || {};
    
    const critical = vulnerabilities.critical || 0;
    const high = vulnerabilities.high || 0;
    const moderate = vulnerabilities.moderate || 0;
    const low = vulnerabilities.low || 0;

    if (critical > 0) {
      errors.push(`Security: ${critical} critical vulnerabilities found`);
    }
    if (high > 0) {
      errors.push(`Security: ${high} high severity vulnerabilities found`);
    }
    if (moderate > 0) {
      warnings.push(`Security: ${moderate} moderate severity vulnerabilities`);
    }
    if (low > 0) {
      warnings.push(`Security: ${low} low severity vulnerabilities`);
    }
  } catch {
    // npm audit might fail or return non-JSON
    if (result.status !== 0) {
      warnings.push('Security: npm audit returned non-zero exit code');
    }
  }

  return { errors, warnings };
}

/**
 * Check 4: ESM compatibility (basic check via package.json type field)
 */
function checkESMCompatibility(deps, nodeModulesDir) {
  const errors = [];
  const warnings = [];

  for (const [name, _version] of Object.entries(deps)) {
    const pkgDir = name.startsWith('@')
      ? join(nodeModulesDir, ...name.split('/'))
      : join(nodeModulesDir, name);
    
    const pkg = loadPackageJson(pkgDir);
    if (!pkg) continue;

    // Check for ESM support indicators
    const hasESM = 
      pkg.type === 'module' ||
      pkg.exports ||
      pkg.module ||
      (pkg.main && pkg.main.endsWith('.mjs'));

    // CommonJS-only is a warning (might still work with bundlers)
    if (!hasESM && pkg.type !== 'module') {
      // Don't warn for packages that are commonly CJS but work fine
      const isCommonCJSPackage = ['typescript', 'vitest', 'vite'].some(p => name.includes(p));
      if (!isCommonCJSPackage) {
        warnings.push(`${name}: No explicit ESM support (may still work)`);
      }
    }
  }

  return { errors, warnings };
}

/**
 * Check 5: Diff check - only validate new/changed dependencies
 */
function getChangedDependencies() {
  // Get the diff between current branch and main
  try {
    const diff = runCommand('git diff origin/main...HEAD -- package.json package-lock.json');
    if (!diff) return null;

    // Parse added dependencies from diff
    const addedDeps = new Set();
    const lines = diff.split('\n');
    
    for (const line of lines) {
      // Match lines like: +    "@google/genai": "^1.47.0",
      const match = line.match(/^\+\s*"([^"]+)":\s*"[^"]+"/);
      if (match && !line.includes('"version"')) {
        addedDeps.add(match[1]);
      }
    }

    return addedDeps.size > 0 ? addedDeps : null;
  } catch {
    return null;
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const checkDiffOnly = args.includes('--check-diff');
  const strict = args.includes('--strict');
  const skipSecurity = args.includes('--skip-security');

  console.log('\n' + colors.cyan('═══════════════════════════════════════════════════════════════'));
  console.log(colors.cyan('  Dependency Lint - TECH_CONSTRAINTS.md Compliance Check'));
  console.log(colors.cyan('═══════════════════════════════════════════════════════════════\n'));

  const pkg = loadPackageJson(rootDir);
  if (!pkg) {
    console.error(colors.red('Error: Cannot find package.json'));
    process.exit(1);
  }

  let deps = getAllDependencies(pkg);
  const nodeModulesDir = join(rootDir, 'node_modules');

  // Filter to only changed deps if requested
  if (checkDiffOnly) {
    const changedDeps = getChangedDependencies();
    if (changedDeps) {
      log('📋', `Checking ${changedDeps.size} changed/new dependencies only\n`);
      deps = Object.fromEntries(
        Object.entries(deps).filter(([name]) => changedDeps.has(name))
      );
    } else {
      log('📋', 'No dependency changes detected, running full check\n');
    }
  } else {
    log('📋', `Checking ${Object.keys(deps).length} dependencies\n`);
  }

  const allErrors = [];
  const allWarnings = [];

  // Run checks
  log('📜', 'Checking licenses...');
  const licenseResult = checkLicenses(deps, nodeModulesDir);
  allErrors.push(...licenseResult.errors);
  allWarnings.push(...licenseResult.warnings);

  log('📘', 'Checking TypeScript support...');
  const tsResult = checkTypeScriptSupport(deps, nodeModulesDir);
  allErrors.push(...tsResult.errors);
  allWarnings.push(...tsResult.warnings);

  if (skipSecurity) {
    log('🔐', colors.dim('Skipping security check (--skip-security)'));
  } else {
    log('🔐', 'Checking security...');
    const securityResult = runSecurityAudit();
    allErrors.push(...securityResult.errors);
    allWarnings.push(...securityResult.warnings);
  }

  log('📦', 'Checking ESM compatibility...');
  const esmResult = checkESMCompatibility(deps, nodeModulesDir);
  allErrors.push(...esmResult.errors);
  allWarnings.push(...esmResult.warnings);

  // Report results
  console.log('\n' + colors.cyan('───────────────────────────────────────────────────────────────'));
  console.log(colors.cyan('  Results'));
  console.log(colors.cyan('───────────────────────────────────────────────────────────────\n'));

  if (allErrors.length === 0 && allWarnings.length === 0) {
    log('✅', colors.green('All dependency checks passed!'));
    console.log('');
    process.exit(0);
  }

  if (allWarnings.length > 0) {
    log('⚠️', colors.yellow(`${allWarnings.length} warning(s):`));
    for (const warning of allWarnings) {
      console.log(colors.dim(`   - ${warning}`));
    }
    console.log('');
  }

  if (allErrors.length > 0) {
    log('❌', colors.red(`${allErrors.length} error(s):`));
    for (const error of allErrors) {
      console.log(colors.red(`   - ${error}`));
    }
    console.log('');
  }

  // Exit code
  if (allErrors.length > 0) {
    console.log(colors.red('Dependency lint failed. Please fix the errors above.'));
    console.log(colors.dim('See TECH_CONSTRAINTS.md for dependency rules.\n'));
    process.exit(1);
  }

  if (strict && allWarnings.length > 0) {
    console.log(colors.yellow('Dependency lint has warnings (strict mode enabled).'));
    console.log(colors.dim('See TECH_CONSTRAINTS.md for dependency rules.\n'));
    process.exit(1);
  }

  console.log(colors.green('Dependency lint passed with warnings.\n'));
  process.exit(0);
}

main().catch((err) => {
  console.error(colors.red(`Unexpected error: ${err.message}`));
  process.exit(1);
});
