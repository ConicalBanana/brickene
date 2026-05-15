# Backend API Examples

These examples assume the local render server is running on `http://127.0.0.1:8765`.

## Health check

```bash
curl http://127.0.0.1:8765/health
```

## Generate a brick definition from SMILES

```bash
curl -X POST http://127.0.0.1:8765/brick-config \
    -H 'Content-Type: application/json' \
    -d '{
        "smiles": "[*:1]C=C([*:2])O",
        "brick_type": "BRIDGE",
        "name": "Vinyl alcohol",
        "alias": ["VA"]
    }'
```

## Render a full graph to PNG

```bash
curl -X POST http://127.0.0.1:8765/render \
    -H 'Content-Type: application/json' \
    -d '{
        "nodes": [
            {
                "id": 1,
                "nodeTypeId": "4",
                "portConfiguration": [
                    {"slotId": 0, "side": "right", "actualPortId": "1"}
                ]
            },
            {
                "id": 2,
                "nodeTypeId": "5",
                "portConfiguration": [
                    {"slotId": 0, "side": "left", "actualPortId": "1"}
                ]
            }
        ],
        "edges": [
            {
                "id": 1,
                "startNode": 1,
                "startPort": 0,
                "endNode": 2,
                "endPort": 0
            }
        ]
    }' \
    --output graph.png
```

## Store a user-defined brick

```bash
curl -X POST http://127.0.0.1:8765/bricks \
    -H 'Content-Type: application/json' \
    -d '{
        "definition": {
            "name": "Inline aldehyde",
            "alias": ["IAL"],
            "brick_type": "BRIDGE",
            "nodes": [
                {"kind": "port", "index": 1, "side": "left", "preferred_brick_type": "SKELETON", "connected_symbol": "C"},
                {"kind": "atom", "index": 2, "symbol": "C"},
                {"kind": "atom", "index": 3, "symbol": "O"},
                {"kind": "port", "index": 4, "side": "right", "preferred_brick_type": "SIDE_CHAIN", "connected_symbol": "C"}
            ],
            "edges": [
                [1, 2, "SINGLE"],
                [2, 3, "DOUBLE"],
                [2, 4, "SINGLE"]
            ]
        }
    }'
```

## List stored bricks

```bash
curl http://127.0.0.1:8765/bricks
```

## Fetch one stored brick

```bash
curl http://127.0.0.1:8765/bricks/user-1
```

## Render one brick definition directly to PNG

```bash
curl -X POST http://127.0.0.1:8765/brick-render \
    -H 'Content-Type: application/json' \
    -d '{
        "name": "Inline aldehyde",
        "alias": ["IAL"],
        "brick_type": "BRIDGE",
        "nodes": [
            {"kind": "port", "index": 1, "side": "left", "preferred_brick_type": "SKELETON", "connected_symbol": "C"},
            {"kind": "atom", "index": 2, "symbol": "C"},
            {"kind": "atom", "index": 3, "symbol": "O"},
            {"kind": "port", "index": 4, "side": "right", "preferred_brick_type": "SIDE_CHAIN", "connected_symbol": "C"}
        ],
        "edges": [
            [1, 2, "SINGLE"],
            [2, 3, "DOUBLE"],
            [2, 4, "SINGLE"]
        ]
    }' \
    --output brick.png
```

## Render a full graph to SMILES

```bash
{
    "error": "definition must be a JSON object."
}
```
                "status": "active",
                "priority": "high"
            }
        },
        {
            "id": "resource_id_2",
            "operation": "update",
            "data": {
                "status": "inactive",
                "priority": "low"
            }
        },
        {
            "id": "resource_id_3",
            "operation": "delete"
        }
    ]
}

response = requests.post(
    f"{BASE_URL}/batch",
    headers=headers,
    data=json.dumps(batch_data)
)

results = response.json()
print(f"Batch operation completed with {results['success_count']} successes and {results['error_count']} errors")
```

### Webhooks Setup

```python
import requests
import json

API_KEY = "your_api_key_here"
BASE_URL = "https://api.example.com/v1"

headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

# Register a webhook to receive notifications
webhook_data = {
    "url": "https://your-app.com/webhook-receiver",
    "events": ["resource.created", "resource.updated", "resource.deleted"],
    "active": True,
    "secret": "your_webhook_secret_for_signature_verification"
}

response = requests.post(
    f"{BASE_URL}/webhooks",
    headers=headers,
    data=json.dumps(webhook_data)
)

if response.status_code == 201:
    webhook = response.json()
    print(f"Webhook registered with ID: {webhook['id']}")
    print(f"Subscribed to events: {', '.join(webhook['events'])}")
else:
    print(f"Error: {response.status_code}")
    print(response.text)
```

## Next Steps

Now that you've seen these examples, you can:

1. Explore the [API Overview](/api/) for more detailed documentation
2. Check our [GitHub repository](https://github.com/ConicalBanana/brickene) for more code samples
3. Join our [community forum](https://example.com/forum) to ask questions and share your implementations
