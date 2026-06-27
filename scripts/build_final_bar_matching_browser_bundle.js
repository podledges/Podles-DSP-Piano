"use strict";

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const outputPath = path.join(repoRoot, "web_app", "final_bar_matching.browser.js");

const publicModules = {
    scoreNormalizer: "final_bar_matching/score_normalizer.js",
    frequencyScorePipeline: "final_bar_matching/frequency_score_pipeline.js",
    fullScoreProgressTracker: "final_bar_matching/full_score_progress_tracker.js",
    frequencyEventAdapter: "final_bar_matching/frequency_event_adapter.js",
    frequencyToMidi: "final_bar_matching/frequency_to_midi.js",
    chordCompare: "final_bar_matching/chord_compare.js"
};

const moduleIds = new Map();
const modules = [];

function toPosixPath(filePath) {
    return filePath.split(path.sep).join("/");
}

function resolveModule(fromFile, request) {
    if (!request.startsWith(".")) {
        throw new Error(`Unsupported non-relative require '${request}' in ${toPosixPath(path.relative(repoRoot, fromFile))}`);
    }

    const basePath = path.resolve(path.dirname(fromFile), request);
    const candidates = [basePath, `${basePath}.js`, path.join(basePath, "index.js")];
    const resolved = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());

    if (!resolved) {
        throw new Error(`Cannot resolve '${request}' from ${toPosixPath(path.relative(repoRoot, fromFile))}`);
    }

    if (!resolved.startsWith(path.join(repoRoot, "final_bar_matching"))) {
        throw new Error(`Resolved module outside final_bar_matching: ${toPosixPath(path.relative(repoRoot, resolved))}`);
    }

    return resolved;
}

function extractRequires(source) {
    const requires = [];
    const requireRegex = /require\(\s*["']([^"']+)["']\s*\)/g;
    let match;

    while ((match = requireRegex.exec(source)) !== null) {
        requires.push(match[1]);
    }

    return requires;
}

function addModule(absPath) {
    const normalizedPath = path.normalize(absPath);
    if (moduleIds.has(normalizedPath)) {
        return moduleIds.get(normalizedPath);
    }

    const relPath = toPosixPath(path.relative(repoRoot, normalizedPath));
    const id = modules.length;
    moduleIds.set(normalizedPath, id);

    const source = fs.readFileSync(normalizedPath, "utf8");
    const dependencyMap = {};

    modules.push({
        id,
        relPath,
        source,
        dependencyMap
    });

    extractRequires(source).forEach((request) => {
        const dependencyPath = resolveModule(normalizedPath, request);
        dependencyMap[request] = addModule(dependencyPath);
    });

    return id;
}

function buildBundle() {
    const publicEntries = {};
    Object.entries(publicModules).forEach(([name, relPath]) => {
        const absPath = path.join(repoRoot, relPath);
        if (!fs.existsSync(absPath)) {
            throw new Error(`Public module missing: ${relPath}`);
        }
        publicEntries[name] = addModule(absPath);
    });

    const sortedModules = modules.slice().sort((a, b) => a.id - b.id);
    const moduleTable = sortedModules.map((moduleDef) => {
        return [
            `        ${JSON.stringify(moduleDef.id)}: {`,
            `            filename: ${JSON.stringify(moduleDef.relPath)},`,
            `            deps: ${JSON.stringify(moduleDef.dependencyMap, Object.keys(moduleDef.dependencyMap).sort())},`,
            "            factory: function(require, module, exports) {",
            moduleDef.source.split(/\r?\n/).map((line) => `                ${line}`).join("\n"),
            "            }",
            "        }"
        ].join("\n");
    }).join(",\n");

    return [
        "// GENERATED FILE - DO NOT EDIT DIRECTLY",
        "// Source: scripts/build_final_bar_matching_browser_bundle.js",
        "(function(global) {",
        "    \"use strict\";",
        "    var modules = {",
        moduleTable,
        "    };",
        "    var cache = {};",
        "    function localRequire(id) {",
        "        if (cache[id]) return cache[id].exports;",
        "        if (!modules[id]) throw new Error(\"Module not found in FinalBarMatching bundle: \" + id);",
        "        var module = { exports: {} };",
        "        cache[id] = module;",
        "        function requireFromModule(request) {",
        "            var dependencyId = modules[id].deps[request];",
        "            if (dependencyId === undefined) throw new Error(\"Dependency not found: \" + request + \" from \" + modules[id].filename);",
        "            return localRequire(dependencyId);",
        "        }",
        "        modules[id].factory(requireFromModule, module, module.exports);",
        "        return module.exports;",
        "    }",
        `    var publicEntries = ${JSON.stringify(publicEntries, Object.keys(publicEntries).sort())};`,
        "    var api = {};",
        "    Object.keys(publicEntries).forEach(function(name) {",
        "        var exports = localRequire(publicEntries[name]);",
        "        Object.keys(exports).forEach(function(exportName) {",
        "            api[exportName] = exports[exportName];",
        "        });",
        "    });",
        "    api.__bundleInfo = Object.freeze({",
        "        generated: true,",
        `        moduleCount: ${sortedModules.length},`,
        "        source: \"final_bar_matching\"",
        "    });",
        "    global.FinalBarMatching = Object.freeze(api);",
        "})(typeof window !== \"undefined\" ? window : globalThis);",
        ""
    ].join("\n");
}

function main() {
    const bundle = buildBundle();
    fs.writeFileSync(outputPath, bundle, "utf8");
    const relOutput = toPosixPath(path.relative(repoRoot, outputPath));
    console.log(`Wrote ${relOutput} (${Buffer.byteLength(bundle, "utf8")} bytes)`);
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = {
    buildBundle,
    main,
    outputPath,
    publicModules
};
