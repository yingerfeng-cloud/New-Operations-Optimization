export function JsonViewer({value}:{value:unknown}){return <pre className="json-viewer">{JSON.stringify(value??{},null,2)}</pre>}
