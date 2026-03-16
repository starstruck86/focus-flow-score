
-- Clean up remaining OOB/churning records
DELETE FROM opportunities WHERE churn_risk = 'certain';
DELETE FROM renewals WHERE churn_risk = 'certain';
