from rest_framework import serializers


class HealthSerializer(serializers.Serializer[dict[str, str]]):
    status = serializers.CharField()
    version = serializers.CharField()
