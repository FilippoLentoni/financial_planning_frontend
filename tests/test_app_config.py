from __future__ import annotations

import pathlib


def test_static_frontend_assets_exist() -> None:
    assert pathlib.Path("app/site/index.html").exists()
    assert pathlib.Path("app/site/app.js").exists()
    assert pathlib.Path("app/server.py").exists()


def test_container_serves_public_runtime_config() -> None:
    server = pathlib.Path("app/server.py").read_text(encoding="utf-8")
    dockerfile = pathlib.Path("app/Dockerfile").read_text(encoding="utf-8")
    assert "/runtime-config.js" in server
    assert "BACKEND_API_URL" in server
    assert "RUNTIME_ARN" in server
    assert "EXPOSE 8080" in dockerfile


def test_frontend_stack_does_not_deploy_backend_resources() -> None:
    stack = pathlib.Path("lib/financial-planning-frontend-stack.ts").read_text(encoding="utf-8")
    forbidden = [
        "aws_dynamodb",
        "aws_s3 as s3",
        "textract:",
        "AgentRuntime",
        "RuntimeAuthorizerConfiguration",
        "ProcessingTable",
        "EventsTable",
    ]
    for token in forbidden:
        assert token not in stack


def test_frontend_uses_backend_runtime_configuration() -> None:
    config = pathlib.Path("lib/config.ts").read_text(encoding="utf-8")
    stack = pathlib.Path("lib/financial-planning-frontend-stack.ts").read_text(encoding="utf-8")
    runtime = pathlib.Path("app/site/services/runtime-service.js").read_text(encoding="utf-8")
    bedrock = pathlib.Path("app/site/services/bedrock-service.js").read_text(encoding="utf-8")
    chatbot = pathlib.Path("app/site/components/chatbot/chatbot.js").read_text(encoding="utf-8")
    assert "BACKEND_API_URL" in config
    assert "RUNTIME_ARN" in config
    assert "RUNTIME_WS_URL" in stack
    assert "this._runtimeEndpoint" in runtime
    assert "bedrock-agentcore" in runtime
    assert "_cleanConfigValue" in runtime
    assert "Built runtime endpoint from ARN" in runtime
    assert "invalid AgentCore endpoint" in runtime
    assert "isDirectRuntimeEndpoint &&" in runtime
    assert "bedrock:InvokeModel" not in stack
    assert "bedrock:InvokeModelWithResponseStream" not in stack
    assert "Direct browser Bedrock model invocation is disabled" in bedrock
    assert "Backend runtime is not configured" in chatbot


def test_frontend_provisions_cognito_auth() -> None:
    stack = pathlib.Path("lib/financial-planning-frontend-stack.ts").read_text(encoding="utf-8")
    app = pathlib.Path("app/site/app.js").read_text(encoding="utf-8")
    auth = pathlib.Path("app/site/services/auth-service.js").read_text(encoding="utf-8")
    assert "new cognito.UserPool" in stack
    assert "new cognito.CfnIdentityPool" in stack
    assert "CognitoCallbackUrls" in stack
    assert "enableDemoSession" not in app
    assert "enableDemoSession" not in auth


def test_markdown_preserves_agentcore_tool_names() -> None:
    markdown = pathlib.Path("app/site/utils/markdown.js").read_text(encoding="utf-8")
    assert "identifierPlaceholders" in markdown
    assert "___[a-zA-Z0-9_-]+" in markdown
    assert "AgentCore tool names" in markdown
    assert "normalizeMarkdown" in markdown
    assert "md-table-wrapper" in markdown
    assert "row boundary" in markdown


def test_model_run_metadata_panel_is_wired() -> None:
    app = pathlib.Path("app/site/app.js").read_text(encoding="utf-8")
    runtime = pathlib.Path("app/site/services/runtime-service.js").read_text(encoding="utf-8")
    styles = pathlib.Path("app/site/styles.css").read_text(encoding="utf-8")
    stack = pathlib.Path("lib/financial-planning-frontend-stack.ts").read_text(encoding="utf-8")
    assert "modelRunPanel" in app
    assert "loadModelRuns" in app
    assert "copyTextToClipboard" in app
    assert "data-copy-value" in app
    assert "/planning/runs" in app
    assert "invokeBackendApi" in runtime
    assert "model-run-panel" in styles
    assert "model-run-copy-btn" in styles
    assert "GET/planning/runs" in stack


if __name__ == "__main__":
    test_static_frontend_assets_exist()
    test_container_serves_public_runtime_config()
    test_frontend_stack_does_not_deploy_backend_resources()
    test_frontend_uses_backend_runtime_configuration()
    test_frontend_provisions_cognito_auth()
    test_markdown_preserves_agentcore_tool_names()
    test_model_run_metadata_panel_is_wired()
    print("OK")
