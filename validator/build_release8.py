# SPDX-FileCopyrightText: 2026 PNED G.I.E.
# SPDX-License-Identifier: Apache-2.0

"""Build offline, explicitly adapted Release 8 bundles from verified originals."""
import hashlib
import json
from pathlib import Path

from rdflib import Dataset, Graph, OWL, SH, URIRef

ROOT = Path(__file__).resolve().parent / 'release-8'


def build():
    upstream = ROOT / 'upstream'
    manifest = json.loads((upstream / 'manifest.json').read_text())
    for item in manifest['files']:
        raw = (upstream / item['file']).read_bytes()
        if hashlib.sha256(raw).hexdigest() != item['sha256']:
            raise ValueError(f"Upstream checksum mismatch: {item['file']}")
    skos = (ROOT / 'skos.rdf').read_bytes()
    if hashlib.sha256(skos).hexdigest() != 'e79633b8d0564816cee8a99f5c9acf9a0e6fc7257c7209acd684ecad53a89dd6':
        raise ValueError('SKOS checksum mismatch')
    config = dict(
        line.split('=', 1) for line in (upstream / 'config.properties').read_text().splitlines()
        if '=' in line and not line.lstrip().startswith('#')
    )
    config = {key.strip(): value.strip() for key, value in config.items()}
    mappings = {
        value: config[key.replace('.uri', '.file')]
        for key, value in config.items()
        if key.startswith('validator.owlImportMapping.') and key.endswith('.uri')
    }
    mappings.update({
        'http://purl.org/dc/terms/': 'catalogue/dublin_core_terms.ttl',
        'http://www.w3.org/ns/prov-o#': 'catalogue/prov-o.ttl',
        'http://www.w3.org/ns/prov': 'catalogue/prov-o.ttl',
        'http://www.w3.org/2004/02/skos/core': '../skos.rdf',
    })
    skipped = set(config['validator.owlImportSkippedUris'].split(','))
    for level in ('public', 'non-public', 'restricted'):
        bundle = Dataset()
        shapes = bundle.graph(URIRef('urn:release8:shapes'))
        dependencies = bundle.graph(URIRef('urn:release8:dependencies'))
        loaded = set()
        corrections = []

        def load(relative):
            if relative in loaded:
                return
            loaded.add(relative)
            path = upstream / relative
            graph = Graph().parse(path, format='turtle' if path.suffix == '.ttl' else 'xml')
            # SHACL logical constraints without a path apply to the focus node.
            for parent, child in list(graph.subject_objects(SH.property)):
                if not list(graph.objects(child, SH.path)):
                    if not list(graph.objects(child, SH['or'])):
                        raise ValueError(f'Unexpected pathless property in {relative}')
                    graph.remove((parent, SH.property, child))
                    graph.add((parent, SH.node, child))
                    corrections.append(relative)
            target = shapes if any(graph.triples((None, SH.targetClass, None))) or any(
                graph.triples((None, SH.property, None))) or relative.startswith(('shapes/', 'deprecated/')) else dependencies
            target += graph
            for imported in graph.objects(None, OWL.imports):
                uri = str(imported)
                if uri in skipped:
                    continue
                if uri not in mappings:
                    raise ValueError(f'Unmapped import: {uri}')
                load(mappings[uri])

        for relative in config[f'validator.shaclFile.{level}'].split(','):
            load(relative.strip())
        if corrections != [f'shapes/{level}-shapes.ttl']:
            raise ValueError(f'Unexpected correction set: {corrections}')
        output = ROOT / f'{level}.trig'
        bundle.serialize(output, format='trig')
        print(f'{level}: {len(shapes)} shape triples, {len(dependencies)} dependency triples; '
              f'{len(corrections)} explicit sh:property -> sh:node corrections')


if __name__ == '__main__':
    build()
