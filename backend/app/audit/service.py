from uuid import UUID

from sqlalchemy.orm import Session

from app.models.publish_audit import PublishAudit


def record_publish_audit(
    db: Session,
    task_id: UUID,
    destination: str,
    package_type: str,
    fields_included: list[str],
    fields_redacted: list[str],
    result: str = "delivered",
) -> PublishAudit:
    row = PublishAudit(
        task_id=task_id,
        destination=destination,
        package_type=package_type,
        fields_included=fields_included,
        fields_redacted=fields_redacted,
        result=result,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
