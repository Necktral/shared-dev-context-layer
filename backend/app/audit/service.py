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
    commit: bool = True,
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
    if commit:
        # Camino de lectura: la auditoría de publicación se persiste por sí misma.
        db.commit()
        db.refresh(row)
    else:
        # Camino de escritura (WP-0.4): sin commit propio; el commit único del
        # pipeline persiste dominio + write_audit + publish_audit atómicamente.
        db.flush()
    return row
