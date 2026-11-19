# SPDX-FileCopyrightText: 2026 PNED G.I.E.
# SPDX-License-Identifier: Apache-2.0

"""One validation per invocation; RDF enters via stdin, JSON leaves via stdout."""
import json
import sys
from pathlib import Path

from pyshacl import validate
from rdflib import Dataset, Graph, RDF, SH, URIRef


def main():
    shapes_path = Path(sys.argv[1]).resolve(strict=True)
    dependencies = Graph()
    if shapes_path.suffix == ".trig":
        bundle = Dataset().parse(shapes_path, format="trig")
        shapes = bundle.graph(URIRef("urn:release8:shapes"))
        dependencies = bundle.graph(URIRef("urn:release8:dependencies"))
        if not len(shapes) or not len(dependencies):
            raise ValueError("Release 8 bundle must contain shapes and dependencies")
    else:
        shapes = Graph().parse(shapes_path, format="turtle")
    if not any(shapes.subjects(RDF.type, SH.NodeShape)) and not any(
        shapes.subjects(RDF.type, SH.PropertyShape)
    ):
        raise ValueError("Shapes file contains no SHACL shapes")
    data = Graph().parse(data=sys.stdin.buffer.read(), format="xml")
    if not any(data.subjects(RDF.type, URIRef("http://www.w3.org/ns/dcat#Dataset"))):
        raise ValueError("Metadata must contain a dcat:Dataset")
    data += dependencies
    conforms, graph, report = validate(
        data, shacl_graph=shapes, inference="none", do_owl_imports=False,
        advanced=False, js=False,
    )
    if not isinstance(graph, Graph):
        raise ValueError(str(report))
    findings = []
    # sh:detail describes why a parent constraint failed. A child Violation
    # inside a Warning is diagnostic, not an independent blocking result.
    # The text report retains those details; policy uses report-level sh:result.
    results = set()
    for validation_report in graph.subjects(RDF.type, SH.ValidationReport):
        results.update(graph.objects(validation_report, SH.result))
    for result in results:
        def text(predicate):
            return "; ".join(str(value) for value in graph.objects(result, predicate))
        findings.append({
            "severity": text(SH.resultSeverity).removeprefix(str(SH)),
            "message": text(SH.resultMessage),
            "focusNode": text(SH.focusNode),
            "path": text(SH.resultPath),
            "value": text(SH.value),
            "constraint": text(SH.sourceConstraintComponent).removeprefix(str(SH)),
        })
    print(json.dumps({"conforms": bool(conforms), "report": str(report), "findings": findings}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
