
-- Delete opportunities linked to churning renewals or marked as certain churn
DELETE FROM opportunities WHERE churn_risk = 'certain';

-- Delete renewals marked as OOB/churning
DELETE FROM renewals WHERE churn_risk = 'certain';
