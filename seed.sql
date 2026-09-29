INSERT INTO settings(key,value) VALUES
('pricing', '{"weekday":23000,"friday":30000,"saturday":34000,"dates":{"2026-11-15":25000}}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value;

INSERT INTO members(id,name,phone,code,note) VALUES
('member-demo-1','Анна Иванова','79010000001','DOMDEMO01',''),
('member-demo-2','Иван Петров','79010000002','DOMDEMO02',''),
('member-demo-3','Мария Сидорова','79010000003','DOMDEMO03','')
ON CONFLICT (id) DO NOTHING;

INSERT INTO point_ledger(member_id,points,kind,reason,request_id) VALUES
('member-demo-1',12,'earned','Demo points','demo-points-1'),
('member-demo-1',4,'deducted','Demo deduction','demo-deduction-1'),
('member-demo-2',8,'earned','Demo points','demo-points-2')
ON CONFLICT (request_id) DO NOTHING;

INSERT INTO calendar_blocks(id,arrival,departure,note,kind,created_at) VALUES
('demo-block-1','2026-11-10','2026-11-12','Demo blocked dates','blocked','2026-10-01T09:00:00Z'),
('demo-block-2','2026-11-20','2026-11-22','Demo reserved period','booked','2026-10-01T09:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO bookings(id,user_id,name,phone,arrival,departure,guests,nights,total,referrer,status,created_at,request_key,early_credited,archived,dates_released,telegram_state,telegram_attempted_at) VALUES
('demo-booking-1','demo-user-1','Елена Кузнецова','79010000004','2026-11-05','2026-11-07',12,2,46000,'member-demo-1','completed','2026-10-01T09:00:00Z','demo-request-key-1',false,false,false,'sent',1700000000000),
('demo-booking-2','demo-user-2','Дмитрий Смирнов','79010000005','2026-11-18','2026-11-20',14,2,62000,NULL,'request','2026-10-01T09:10:00Z','demo-request-key-2',false,false,false,'pending',NULL)
ON CONFLICT (id) DO NOTHING;
