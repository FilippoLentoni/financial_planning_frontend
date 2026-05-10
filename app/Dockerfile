FROM python:3.12-slim

WORKDIR /app
COPY server.py /app/server.py
COPY site /app/site

ENV PORT=8080
EXPOSE 8080

CMD ["python", "/app/server.py"]
