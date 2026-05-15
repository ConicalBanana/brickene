# Backend API

brickene ships a local HTTP backend through `python -m brickene.render_server`. By default it listens on `http://127.0.0.1:8765` and serves rendering, SMILES export, brick-definition generation, and user-defined brick storage.

## Runtime contract

- Base URL: `http://127.0.0.1:8765`
- Authentication: none
- Content type: JSON request and response bodies unless an endpoint explicitly returns PNG bytes
- CORS: enabled for local frontend access

## Endpoints

### `GET /health`

Returns the active server configuration.

Response fields:

- `status`: always `"ok"` when the server is healthy
- `catalog_path`: built-in brick catalog path
- `image_size`: configured render size in pixels
- `brick_db_path`: SQLite database path for user-defined bricks
- `stored_brick_count`: number of stored user-defined bricks

### `POST /render`

Renders a full graph payload to PNG bytes.

Request body:

- `nodes`: frontend node list
- `edges`: frontend edge list

Response:

- `200 OK`
- `Content-Type: image/png`

### `POST /smiles`

Builds a molecule from a full graph payload and returns its capped SMILES string.

Response body:

```json
{
    "smiles": "CC"
}
```

### `POST /brick-config`

Converts one brick SMILES string into a serialized brick definition.

Request body:

- `smiles`: required SMILES string with attachment ports
- `brick_type`: optional, one of `SKELETON`, `SIDE_CHAIN`, `SUBSTITUENT`, `BRIDGE`
- `name`: optional display name
- `alias`: optional string array

Response body:

```json
{
    "definition": {
        "name": "Vinyl alcohol",
        "alias": ["VA"],
        "brick_type": "BRIDGE",
        "nodes": [],
        "edges": []
    }
}
```

### `GET /bricks`

Lists all user-defined bricks stored in SQLite.

Response body:

```json
{
    "bricks": [
        {
            "id": "user-1",
            "name": "Inline aldehyde",
            "alias": ["IAL"],
            "brick_type": "BRIDGE",
            "nodes": [],
            "edges": [],
            "created_at": "2026-05-15 12:00:00",
            "updated_at": "2026-05-15 12:00:00"
        }
    ]
}
```

### `GET /bricks/{id}`

Returns one stored brick definition by id such as `user-1`.

Response body:

```json
{
    "definition": {
        "id": "user-1",
        "name": "Inline aldehyde",
        "alias": ["IAL"],
        "brick_type": "BRIDGE",
        "nodes": [],
        "edges": [],
        "created_at": "2026-05-15 12:00:00",
        "updated_at": "2026-05-15 12:00:00"
    }
}
```

### `POST /bricks`

Stores one user-defined brick definition in SQLite.

Accepted request shapes:

- the raw definition object
- `{ "definition": { ... } }`

Response body:

```json
{
    "definition": {
        "id": "user-1",
        "name": "Inline aldehyde",
        "alias": ["IAL"],
        "brick_type": "BRIDGE",
        "nodes": [],
        "edges": [],
        "created_at": "2026-05-15 12:00:00",
        "updated_at": "2026-05-15 12:00:00"
    }
}
```

### `POST /brick-render`

Renders one brick definition payload directly to PNG bytes without saving it first.

Accepted request shapes:

- the raw definition object
- `{ "definition": { ... } }`

Response:

- `200 OK`
- `Content-Type: image/png`

## Errors

Backend validation errors return `400` with a JSON body:

```json
{
    "error": "definition must be a JSON object."
}
```

Unknown paths return `404`, and unexpected render failures return `500` with an `error` message.

## Related pages

See [Examples](/api/examples) for concrete `curl` and JavaScript request samples.
