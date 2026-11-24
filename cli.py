#!/usr/bin/env python3
"""Command-line entry point for the Automate Procurement workflow.

Mirrors the web backend: reads a folder of ITB PDFs (and screenshots),
classifies them with Gemini and writes a formatted RFQ specification sheet.
"""
import click

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from extractors.pdf_extractor import PDFExtractor
from extractors.universal_extractor import UniversalExtractor
from server.pipeline import run_pipeline
from generators.rfq_dispatcher import RFQDispatcher


@click.group()
def cli():
    """Automate Procurement Process CLI.

    Step 1: ITB Review & Line Item Extraction
    Step 2: Specification Sheet & Reference Document Generation
    Step 3: Vendor Sourcing & RFQ Dispatch
    """
    pass


@cli.command()
@click.option('--itb-dir', default='./data/itb', help='Directory containing ITB files')
@click.option('--output', default='./outputs/specification_sheet.docx', help='Output spec sheet path')
@click.option('--pattern', default='*ITB*', help='Filename glob of source files (default: *ITB*)')
@click.option('--images', default=None, help='Comma-separated image globs to include (default: all supported graphics)')
@click.option('--no-images', is_flag=True, help='Do not send images to Gemini')
@click.option('--model', default=None, help='AI model (default: provider default)')
@click.option('--provider', default=None, type=click.Choice(['gemini', 'openai', 'anthropic'], case_sensitive=False),
              help='AI provider (default: AI_PROVIDER env or gemini)')
@click.option('--skip', default='', help='Comma-separated exact filenames to exclude from extraction')
def extract(itb_dir, output, pattern, images, no_images, model, provider, skip):
    """Steps 1 & 2: extract ITB content and generate the spec sheet."""
    click.echo('Step 1: ITB Review & Line Item Extraction...')
    try:
        result = run_pipeline(
            input_dir=itb_dir,
            output_path=output,
            model=model,
            provider=provider,
            include_images=not no_images,
            image_patterns=[g.strip() for g in images.split(',') if g.strip()] if images else None,
            pattern=pattern,
            skip_files=[s.strip() for s in skip.split(',') if s.strip()],
            progress=lambda stage, current, total, message: click.echo(f'  - {message}'),
        )
    except Exception as exc:
        raise click.ClickException(str(exc)) from exc

    click.echo('Step 2: Generating specification sheet...')
    click.echo(click.style(f'Done: {result["output_path"]}', fg='green'))
    click.echo(f'  - Files processed: {result["data"]["files_processed"]}')
    click.echo(f'  - Line items extracted: {result["data"]["line_items_count"]}')


@cli.command()
def setup_vendors():
    """Step 3a: create the vendor CSV template used for RFQ dispatch."""
    d = RFQDispatcher()
    p = d.create_vendor_template()
    click.echo(click.style(f'Vendor template created: {p}', fg='green'))
    click.echo('Edit vendor_list.csv with your actual vendor data')


@cli.command()
@click.option('--spec-sheet', default='./outputs/specification_sheet.docx', help='Path to spec sheet')
@click.option('--vendor-file', default='./data/vendors/vendor_list.csv', help='Vendor CSV file')
def dispatch(spec_sheet, vendor_file):
    """Step 3b: build an RFQ dispatch package for the loaded vendors."""
    d = RFQDispatcher()
    vendors = d.load_vendors(vendor_file)
    if not vendors:
        click.echo(click.style(f'No vendors found in {vendor_file}. Run setup-vendors first.', fg='yellow'))
        return
    pkg = d.generate_rfq_package(spec_sheet, vendors)
    click.echo(click.style('RFQ package prepared', fg='green'))
    click.echo(f'  - Vendors: {len(vendors)}')
    click.echo(f'  - Summary: {pkg["summary_path"]}')


@cli.command()
@click.option('--itb-dir', default='./data/itb')
@click.option('--pattern', default='*ITB*', help='Filename glob of source files (default: *ITB*)')
def analyze(itb_dir, pattern):
    """Quickly report which documents match and how much text was read from each."""
    pdf_ext = PDFExtractor()
    results = pdf_ext.extract_itb_folder(itb_dir, pattern=pattern)
    results += UniversalExtractor().extract_folder(itb_dir, pattern=pattern)
    for r in results:
        if r.get('error'):
            click.echo(click.style(f'{r["filename"]}: {r["error"]}', fg='red'))
        else:
            click.echo(click.style(f'{r["filename"]}: {r["size"]} chars', fg='green'))


@cli.command()
def run_all():
    """Run extraction and vendor setup back-to-back as one workflow."""
    extract.callback(itb_dir='./data/itb', output='./outputs/specification_sheet.docx',
                     pattern='*ITB*', images=None, no_images=False, model=None, provider=None, skip='')
    setup_vendors.callback()
    click.echo(click.style('\nWorkflow complete!', fg='green'))


if __name__ == '__main__':
    cli()
