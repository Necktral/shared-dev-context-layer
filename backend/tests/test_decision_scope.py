from app.services.decision_service import list_active_decisions_for_scope


def test_decision_inheritance_deduplicates_by_priority(db, active_task):
    decisions = list_active_decisions_for_scope(
        db,
        workspace_id=active_task.workspace_id,
        project_id=active_task.project_id,
        task_id=active_task.id,
    )
    assert decisions

    keys = [decision.decision_key for decision in decisions]
    assert len(keys) == len(set(keys))
    assert "project.default.branch_policy" in keys
    assert "policy.mode.delegated_limited" in keys

    policy_decision = next(decision for decision in decisions if decision.decision_key == "policy.mode.delegated_limited")
    assert policy_decision.task_id == active_task.id
